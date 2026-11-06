# SPDX-License-Identifier: MPL-2.0
# Adapted from Flare CompendiumQuery, revision 3905811; see ../NOTICE.md.
import re
from .secure import canonical, content_files, digest, fail, text
from .builtin import load_builtin

ID = re.compile(r'[A-Za-z0-9_.:-]{1,192}\Z')
class CompendiumQuery:
    """Immutable per-request lookup; never consults global or desktop storage."""
    def __init__(self, files):
        self.elements, self.manifest = {}, []
        _, builtin_root, self.builtin = load_builtin()
        self.builtin_ids = set()
        for element in builtin_root.findall('element'):
            key = element.get('id')
            if not key or not ID.fullmatch(key) or key in self.elements:
                fail('INVALID_BUILTIN', 'builtin', 'Invalid bundled element identifier.')
            self.elements[key] = element
            self.builtin_ids.add(key)
        if not isinstance(files, list): fail('INVALID_REQUEST', 'content', 'Content files must be a list.')
        for name, body, root in content_files(files) if files else []:
            if root.find('append') is not None or root.find('remove') is not None:
                fail('UNSUPPORTED_CONTENT_PATCH', 'content', 'Append/remove content patches are not yet supported; supply resolved element definitions.')
            ids = []
            for element in root.iter('element'):
                key = element.get('id')
                if not key: continue
                if not ID.fullmatch(key): fail('INVALID_ELEMENT_ID', 'content', 'Content element IDs must be bounded simple identifiers.')
                if key in self.elements:
                    if key in self.builtin_ids:
                        if element_definition(element) == element_definition(self.elements[key]):
                            ids.append(key)
                            continue
                        fail('BUILTIN_ELEMENT_CONFLICT', 'content', 'Uploaded definition conflicts with the built-in reference pack: ' + key)
                    fail('DUPLICATE_ELEMENT_ID', 'content', 'Ambiguous duplicate element ID: ' + key)
                if len(self.elements) >= 5000: fail('ELEMENT_LIMIT', 'content', 'Content has more than 5,000 elements.')
                self.elements[key] = element; ids.append(key)
            self.manifest.append(dict(name=name, sha256=digest(body), bytes=len(body), elements=sorted(ids)))
        self.hash = digest(canonical(dict(builtin=self.builtin, privateFiles=self.manifest)))
    def quick_query_id(self, key):
        return self.elements.get(key)
    def read_setter(self, node, field):
        for setter in node.findall('./setters/set') if node is not None else []:
            if setter.get('name') == field: return text(setter)
        return None
    def describe(self, node):
        return text(node.find('./description')) if node is not None else ''
    def result(self):
        required = set()
        for node in self.elements.values():
            for grant in node.findall('./rules/grant'):
                if grant.get('id'): required.add(grant.get('id'))
        return dict(schemaVersion=1, hash=self.hash, builtin=self.builtin, files=self.manifest, elementCount=len(self.elements), dependencies=sorted(required-set(self.elements)))


def element_definition(node):
    """Ignore formatting whitespace and attribute order, never rules or prose."""
    return (node.tag, tuple(sorted(node.attrib.items())), (node.text or '').strip(),
            tuple((element_definition(child), (child.tail or '').strip()) for child in node))
