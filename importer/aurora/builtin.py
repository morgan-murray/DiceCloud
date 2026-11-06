"""Bundled, independently authored 2014 compatibility definitions.

Identifiers interoperate with Aurora; descriptions are new summaries of SRD 5.1.
This is a small reference pack, not a copy of Flare's internal_elements.xml.
See reference/NOTICE.md for provenance, attribution and deliberate exclusions.
"""
from pathlib import Path
from .secure import digest, fail, xml

PACK_ID = 'aurora-core-2014'
PACK_VERSION = '1.0.0'
PACK_PATH = Path(__file__).resolve().parent.parent / 'reference' / 'core-2014.xml'

def load_builtin():
    body = PACK_PATH.read_bytes()
    root = xml(body, 'builtin')
    if root.tag != 'elements': fail('INVALID_BUILTIN', 'builtin', 'Invalid bundled reference pack.')
    manifest = dict(id=PACK_ID, version=PACK_VERSION, name='Aurora Core Reference (2014)',
                    sha256=digest(body), bytes=len(body), scope='builtin',
                    licence='CC-BY-4.0', rulesVersion='2014',
                    source='https://www.dndbeyond.com/attachments/39j2li89/SRD5.1-CCBY4.0License.pdf')
    return body, root, manifest
