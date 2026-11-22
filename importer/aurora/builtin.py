"""Bundled, independently authored 2014 compatibility definitions.

Identifiers interoperate with Aurora; descriptions are new summaries of SRD 5.1.
This is a small reference pack, not a copy of Flare's internal_elements.xml.
See reference/NOTICE.md for provenance, attribution and deliberate exclusions.
"""
from pathlib import Path
from .secure import digest, fail, xml

PACK_ID = 'aurora-core-2014'
PACK_VERSION = '1.1.0'
PACK_PATH = Path(__file__).resolve().parent.parent / 'reference' / 'core-2014.xml'

SITE_PACK_PATH = Path('/etc/dicecloud/aurora-defaults.xml')

def load_builtin():
    body = PACK_PATH.read_bytes()
    root = xml(body, 'builtin')
    if root.tag != 'elements': fail('INVALID_BUILTIN', 'builtin', 'Invalid bundled reference pack.')
    manifest = dict(id=PACK_ID, version=PACK_VERSION, name='Aurora Core Reference (2014) with Rogue and Thief',
                    sha256=digest(body), bytes=len(body), scope='builtin',
                    licence='CC-BY-4.0', rulesVersion='2014',
                    source='https://www.dndbeyond.com/attachments/39j2li89/SRD5.1-CCBY4.0License.pdf')
    # A deployment can install its own resolved rules without publishing private content.
    if SITE_PACK_PATH.is_file():
        site_body = SITE_PACK_PATH.read_bytes()
        site = xml(site_body, 'site defaults')
        if site.tag != 'elements': fail('INVALID_BUILTIN', 'content', 'Invalid site reference pack.')
        defaults = root.find('defaults')
        defaults[:0] = site.findall('element')
        manifest['sitePack'] = dict(sha256=digest(site_body), bytes=len(site_body))
    return body, root, manifest
