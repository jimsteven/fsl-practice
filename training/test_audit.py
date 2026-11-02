import unittest
from audit_dataset import audit


class DatasetAuditTest(unittest.TestCase):
    def rows(self):
        return [dict(clip_id=str(i), signer_id="signer-" + str(i), split=split, sign_id="synthetic-label", consent_reference="synthetic-consent", rights_reference="synthetic-rights", expert_review_reference="synthetic-review", source_sha256=str(i) * 64) for i, split in enumerate(["train", "validation", "test"])]

    def test_independent_signers(self):
        self.assertEqual(audit(self.rows())["clips"], 3)

    def test_signer_and_clip_leakage_are_rejected(self):
        rows = self.rows()
        rows[2]["signer_id"] = rows[0]["signer_id"]
        with self.assertRaisesRegex(ValueError, "Signer leakage"):
            audit(rows)
        rows = self.rows()
        rows[2]["source_sha256"] = rows[0]["source_sha256"]
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            audit(rows)

    def test_missing_consent_is_rejected(self):
        rows = self.rows()
        rows[0]["consent_reference"] = ""
        with self.assertRaisesRegex(ValueError, "consent_reference"):
            audit(rows)


if __name__ == "__main__":
    unittest.main()
