import base64
import io
import stat
import unittest
import zipfile
from aurora.content import CompendiumQuery
from aurora.logic import LogicSolver
from aurora.secure import ImportErrorDetail, xml

def upload(body,name='pack.zip'):return dict(name=name,data=base64.b64encode(body).decode())
def archive(name,body,symlink=False):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED) as z:
        info=zipfile.ZipInfo(name)
        if symlink:info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16
        z.writestr(info,body,compress_type=zipfile.ZIP_DEFLATED)
    return upload(stream.getvalue())
class SecurityTests(unittest.TestCase):
    def test_zip_traversal_and_symlink(self):
        for name in ['../pack.xml','/pack.xml','C:/pack.xml','a\\pack.xml']:
            with self.assertRaises(ImportErrorDetail):CompendiumQuery([archive(name,b'<elements/>')])
        with self.assertRaises(ImportErrorDetail):CompendiumQuery([archive('link.xml',b'/etc/passwd',True)])
    def test_bomb_and_nested_archive(self):
        with self.assertRaises(ImportErrorDetail):CompendiumQuery([archive('bomb.xml',b' '*100000)])
        with self.assertRaises(ImportErrorDetail):CompendiumQuery([archive('inner.zip',b'not xml')])
    def test_duplicate_zip_paths(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:
            z.writestr('a/pack.xml',b'<elements/>');z.writestr('a/./pack.xml',b'<elements/>')
        with self.assertRaises(ImportErrorDetail):CompendiumQuery([upload(stream.getvalue())])
    def test_xml_dtd_entities_pi_and_encoding(self):
        for body in [b'<!DOCTYPE elements SYSTEM "https://example.com/a.dtd"><elements/>',b'<?remote href="https://example.com"?><elements/>',b'<!DOCTYPE elements [<!ENTITY a "x">]><elements>&a;</elements>',b'<elements>\xff</elements>']:
            with self.assertRaises(ImportErrorDetail):xml(body)
    def test_expression_rejects_code_and_unbounded_syntax(self):
        for expression in ['__import__("os").system("id")','x or True','True + False','(' * 300+'True'+')'*300]:
            with self.assertRaises(ImportErrorDetail):LogicSolver.solve_expression(expression)
        self.assertTrue(LogicSolver.solve_expression('True and not False'))
    def test_numeric_cycles_fail_closed(self):
        from test_character import fixture, pack
        from aurora.character import extract
        content=pack();content[0]['data']=base64.b64encode(base64.b64decode(content[0]['data']).replace(b'<stat name="speed" value="30"',b'<stat name="speed" value="speed"')).decode()
        with self.assertRaises(ImportErrorDetail) as error:extract(fixture('martial'),content)
        self.assertEqual(error.exception.diagnostic['code'],'CYCLIC_RULE')
if __name__=='__main__':unittest.main()
