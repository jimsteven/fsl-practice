"""Metadata-only audit scaffold. No training, media access, uploads, or demographics inference."""
import argparse
import json


def audit(rows):
    if not rows:
        raise ValueError("No consented, expert-approved dataset supplied")
    signer_splits, clips, content_hashes = {}, set(), set()
    splits = {"train", "validation", "test"}
    for row in rows:
        for field in ("clip_id", "signer_id", "split", "sign_id", "consent_reference", "rights_reference", "expert_review_reference", "source_sha256"):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError("Missing metadata: " + field)
        if row["split"] not in splits:
            raise ValueError("Invalid split")
        if row["signer_id"] in signer_splits and signer_splits[row["signer_id"]] != row["split"]:
            raise ValueError("Signer leakage across splits")
        signer_splits[row["signer_id"]] = row["split"]
        if row["clip_id"] in clips or row["source_sha256"] in content_hashes:
            raise ValueError("Duplicate clip/content: frame and clip variants must share their source split")
        clips.add(row["clip_id"])
        content_hashes.add(row["source_sha256"])
    if {row["split"] for row in rows} != splits:
        raise ValueError("Train, validation, and signer-disjoint held-out test splits required")
    return {"clips": len(clips), "signers": len(signer_splits), "status": "metadata checks only; consent/rights/reviews require human verification"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", help="JSON array of reviewed clip metadata, never raw video")
    args = parser.parse_args()
    with open(args.manifest, encoding="utf-8") as source:
        print(json.dumps(audit(json.load(source)), indent=2))
