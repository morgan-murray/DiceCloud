"""Strict XML/ZIP ingestion. No URL, entity, path or XInclude resolution."""
import base64
import hashlib
import io
import json
import re
import stat
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET
from xml.parsers import expat

CHAR_LIMIT = 2 * 1024**2
PACK_LIMIT = 4 * 1024**2
EXPANDED_LIMIT = 8 * 1024**2
TEXT_LIMIT = 20000

class ImportErrorDetail(Exception):
    def __init__(self, code, field, message):
        super().__init__(message)
        self.diagnostic = dict(code=code, field=field, message=message, severity='error')

def fail(code, field, message):
    raise ImportErrorDetail(code, field, message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()

def decode(file, limit):
    if not isinstance(file, dict) or set(file) != {'name', 'data'}:
        fail('INVALID_REQUEST', 'file', 'Expected a named base64 file.')
    if not isinstance(file['name'], str) or len(file['name']) > 200 or not isinstance(file['data'], str) or len(file['data']) > (limit * 4 // 3 + 8):
        fail('SIZE_LIMIT', 'file', 'File exceeds its upload limit.')
    try:
        data = base64.b64decode(file['data'], validate=True)
    except (ValueError, TypeError):
        fail('INVALID_ENCODING', 'file', 'File data is not valid base64.')
    if not data or len(data) > limit:
        fail('SIZE_LIMIT', 'file', 'Empty or oversized file.')
    return data

def xml(data, field='xml', *, omit_portrait=False, omitted=None):
    if len(data) > EXPANDED_LIMIT:
        fail('SIZE_LIMIT', field, 'XML exceeds its expanded size limit.')
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        fail('INVALID_ENCODING', field, 'XML must use UTF-8 encoding.')
    parser = expat.ParserCreate('utf-8', namespace_separator='}')
    stack, root, count = [], None, 0
    def forbidden(*args):
        fail('UNSAFE_XML', field, 'DTD, entities, processing instructions and external inclusions are not allowed.')
    parser.StartDoctypeDeclHandler = forbidden
    parser.EntityDeclHandler = forbidden
    parser.ExternalEntityRefHandler = forbidden
    parser.ProcessingInstructionHandler = forbidden
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    def start(tag, attrs):
        nonlocal root, count
        count += 1
        if count > 30000 or len(stack) >= 64 or len(attrs) > 64 or len(tag) > 200 or any(len(k) > 200 or len(v) > TEXT_LIMIT for k, v in attrs.items()):
            fail('XML_LIMIT', field, 'XML node, depth, attribute or string limit exceeded.')
        if '}' in tag or ':' in tag:
            fail('UNSAFE_XML', field, 'Namespaced XML and external inclusions are not supported.')
        node = ET.Element(tag, attrs)
        if stack: stack[-1].append(node)
        else: root = node
        stack.append(node)
    def chars(value):
        if not stack: return
        node = stack[-1]
        # Aurora embeds the portrait as base64 in this exact leaf. Portraits are
        # not part of the snapshot: do not retain, decode, fetch or render them.
        # All upload, node/depth, attribute and unsafe-XML checks still apply.
        if omit_portrait and tuple(n.tag for n in stack) == ('character','display-properties','portrait','base64') and not len(node):
            if omitted is not None and value.strip(): omitted.add('portrait')
            return
        def text_limit():
            path = '/' + '/'.join(n.tag for n in stack)
            fail('XML_LIMIT', field, f'XML text at {path} exceeds {TEXT_LIMIT:,} characters.')
        # Text is retained as inert text; it is never parsed as HTML.
        if len(node):
            child = node[-1]; child.tail = (child.tail or '') + value
            if len(child.tail) > TEXT_LIMIT: text_limit()
        else:
            node.text = (node.text or '') + value
            if len(node.text) > TEXT_LIMIT: text_limit()
    parser.StartElementHandler, parser.EndElementHandler, parser.CharacterDataHandler = start, lambda tag: stack.pop(), chars
    try:
        parser.Parse(text, True)
    except expat.ExpatError:
        fail('MALFORMED_XML', field, 'The file is not well-formed XML.')
    if root is None: fail('MALFORMED_XML', field, 'XML document is empty.')
    return root

def content_files(files):
    if not isinstance(files, list) or not 1 <= len(files) <= 100:
        fail('FILE_LIMIT', 'content', 'Choose between one and 100 XML/ZIP files.')
    result, paths, total = [], set(), 0
    for source in files:
        data = decode(source, PACK_LIMIT)
        name = source['name']
        path = PurePosixPath(name)
        if not name or '\\' in name or path.is_absolute() or '..' in path.parts or ':' in name or not path.parts or any(ord(c) < 32 for c in name):
            fail('UNSAFE_PATH', 'content', 'Content filename is unsafe.')
        entries = []
        if name.lower().endswith('.zip'):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    if len(archive.infolist()) > 100: fail('FILE_LIMIT', 'content', 'Archive contains too many entries.')
                    for info in archive.infolist():
                        path = PurePosixPath(info.filename)
                        mode = info.external_attr >> 16
                        if '\\' in info.filename or path.is_absolute() or '..' in path.parts or ':' in info.filename or not path.parts or any(len(p) > 200 for p in path.parts):
                            fail('UNSAFE_ARCHIVE', 'content', 'Archive contains an unsafe path.')
                        if info.is_dir(): continue
                        if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or info.flag_bits & 1 or not info.filename.lower().endswith('.xml'):
                            fail('UNSAFE_ARCHIVE', 'content', 'Archive must contain only unencrypted regular XML files.')
                        if info.file_size > EXPANDED_LIMIT or info.file_size > max(info.compress_size, 1) * 200:
                            fail('ARCHIVE_LIMIT', 'content', 'Archive expansion limit exceeded.')
                        if total + sum(len(b) for _, b in entries) + info.file_size > EXPANDED_LIMIT:
                            fail('ARCHIVE_LIMIT', 'content', 'Expanded content exceeds 8 MiB.')
                        with archive.open(info) as stream: body = stream.read(EXPANDED_LIMIT + 1)
                        if len(body) != info.file_size: fail('UNSAFE_ARCHIVE', 'content', 'Archive entry size mismatch.')
                        entries.append((info.filename, body))
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError):
                fail('UNSAFE_ARCHIVE', 'content', 'Invalid or unsupported ZIP archive.')
        elif name.lower().endswith('.xml'):
            entries.append((name, data))
        else: fail('UNSUPPORTED_FILE', 'content', 'Content must be XML or a ZIP containing XML.')
        for path, body in entries:
            normalized = str(PurePosixPath(path))
            if normalized in paths: fail('DUPLICATE_FILE', 'content', 'Duplicate content filenames are not allowed.')
            paths.add(normalized); total += len(body)
            if total > EXPANDED_LIMIT or len(result) >= 100: fail('ARCHIVE_LIMIT', 'content', 'Content size or file-count limit exceeded.')
            tree = xml(body, 'content')
            if tree.tag != 'elements': fail('CONTENT_ROOT', 'content', 'Content XML must have an elements root.')
            result.append((normalized, body, tree))
    if not result: fail('CONTENT_ROOT', 'content', 'No content XML files were found.')
    return sorted(result, key=lambda f: f[0])

def text(node):
    return ''.join(node.itertext()).strip() if node is not None else ''

def number(value, field, low=-10000, high=1000000):
    try:
        if isinstance(value, bool): raise ValueError()
        n = int(str(value))
        if not re.fullmatch(r'[+-]?\d+', str(value).strip()) or not low <= n <= high: raise ValueError()
        return n
    except (ValueError, TypeError):
        fail('INVALID_NUMBER', field, 'Expected a whole number within the supported range.')
