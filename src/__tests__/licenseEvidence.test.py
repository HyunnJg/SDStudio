"""Exercise output boundaries and provenance on disposable Git repositories."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / '.erb/scripts/collect-license-evidence.py'


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sdstudio-license-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        files = {
            '.erb/scripts/collect-license-evidence.py': SCRIPT.read_text(),
            'package.json': json.dumps({'name': 'fixture', 'build': {}}),
            'package-lock.json': json.dumps({'packages': {'': {}}}),
            'release/app/package.json': '{}',
            'release/app/package-lock.json': json.dumps({'packages': {'': {}}}),
            'src/native/package.json': '{}',
            'src/native/package-lock.json': json.dumps({'packages': {'': {}}}),
            '.gitmodules': '',
            'assets/example.txt': 'synthetic asset',
        }
        for path, text in files.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        (self.root / 'src/localai').mkdir(parents=True)
        (self.root / 'src/localai/requirements.txt').write_bytes('fixture==1.0\n'.encode('utf-16'))
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True).strip()

    def collect(self, output):
        return subprocess.run([sys.executable, str(self.root / '.erb/scripts/collect-license-evidence.py'),
                               '--output', str(output)], cwd=self.root, text=True, capture_output=True)

    def test_clean_snapshot_reproduces_with_head_and_no_warning(self):
        first, second = [Path(self.temp.name) / name for name in ('one', 'two')]
        a, b = self.collect(first), self.collect(second)
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertEqual(b.returncode, 0, b.stderr)
        self.assertEqual(a.stderr, '')
        data = json.loads((first / 'tracked-inventory.json').read_text())
        self.assertEqual(data['gitHead'], self.git('rev-parse', 'HEAD'))
        self.assertFalse(data['dirty'])
        self.assertEqual((first / 'tracked-inventory.json').read_bytes(),
                         (second / 'tracked-inventory.json').read_bytes())

    def test_dirty_input_warns_and_hashes_working_tree(self):
        asset = self.root / 'assets/example.txt'
        asset.write_text('edited after commit')
        out = Path(self.temp.name) / 'dirty'
        result = self.collect(out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('WARNING', result.stderr)
        data = json.loads((out / 'tracked-inventory.json').read_text())
        self.assertTrue(data['dirty'])
        recorded = next(x for x in data['assets'] if x['path'] == 'assets/example.txt')
        self.assertEqual(recorded['sha256'], hashlib.sha256(asset.read_bytes()).hexdigest())

    def test_source_git_and_license_root_outputs_are_rejected_before_writes(self):
        for suffix in ('', 'src/renderer', 'assets/fonts/out', 'release/output', '.git/evidence', '.erb/out', 'docs/licenses'):
            with self.subTest(suffix=suffix):
                output = self.root / suffix
                result = self.collect(output)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((output / 'tracked-inventory.json').exists())
                self.assertFalse((output / 'notices').exists())

    def test_approved_subfolder_and_outside_directory_are_allowed(self):
        for output in (self.root / 'docs/licenses/test-output', Path(self.temp.name) / 'outside'):
            with self.subTest(output=output):
                result = self.collect(output)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue((output / 'tracked-inventory.json').exists())

    def test_symlink_to_git_directory_is_rejected(self):
        parent = self.root / 'docs/licenses'
        parent.mkdir(parents=True)
        (parent / 'redirect').symlink_to(self.root / '.git', target_is_directory=True)
        result = self.collect(parent / 'redirect/evidence')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / '.git/evidence').exists())


if __name__ == '__main__':
    unittest.main()
