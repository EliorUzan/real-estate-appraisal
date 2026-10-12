import runpy
import unittest
from pathlib import Path


class SyntheticDiagnosticTests(unittest.TestCase):
    def test_redacts_credentials_urls_and_bounds_operator_error(self):
        helper = runpy.run_path(str(Path(__file__).resolve().parents[2] /
            'deploy/cli-gateway/diagnose-search.py'))['diagnostic_text']
        secret = 'sample-sensitive-value'
        for text in ('Bearer ' + secret, 'token=' + secret,
                     'https://example.test/oauth?code=' + secret,
                     'person@example.test', 'x' * 48):
            result = helper(text)
            self.assertNotIn(secret, result)
            self.assertNotIn('person@example.test', result)
            self.assertNotIn('x' * 48, result)
        self.assertLessEqual(len(helper('error ' * 1000)), 1200)
        self.assertIn('search failed', helper('search failed'))


if __name__ == '__main__':
    unittest.main()
