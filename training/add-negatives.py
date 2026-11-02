"""Add more rights-cleared FSL-105 v2 clips as unsupported ("other") examples.

Reads only the SHA-256 verified local clips.zip and CSVs from setup-content.py.
Writes .tools/fsl105/samples-extended.json; extract.mjs then reuses existing
feature rows and extracts only the new clips.

Splits stay clip-disjoint and add a class-level hold-out:
- Six-Ten (25-29): the training clips not already used for calibration become
  "other" training rows. Their original test clips stay the comparable test.
- Other signs with an even dataset ID: 3 training clips train "other", the next
  2 calibrate rejection, original test clips evaluate ("seen-class").
- Other signs with an odd dataset ID never reach training or calibration; their
  original test clips measure rejection of unseen signs ("unseen-class").

FSL-105 contains byte-identical clips filed under different labels (for
example clips/23/6.MOV "Four" and clips/26/7.MOV "Seven"). Every clip whose
SHA-256 appears under more than one label anywhere in the archive is dropped
from all splits, and same-label copies keep only their first occurrence, so no
duplicate can cross train/calibration/test.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.tools' / 'fsl105'
ARCHIVE_SHA = 'c048c0820be1621101dfedeabb76a9fbfca76ed2868eebe23b4cb90d5c748463'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def rows(name):
    return [{**r, 'vid_path': r['vid_path'].replace('\\', '/'), 'id_label': int(r['id_label'])}
            for r in csv.DictReader(io.StringIO((CACHE / name).read_text(encoding='utf-8-sig')))]


def number(row):
    return int(row['vid_path'].split('/')[-1].split('.')[0])


def main():
    if digest(CACHE / 'clips.zip') != ARCHIVE_SHA:
        raise RuntimeError('clips.zip is missing or changed; run npm run setup:content first.')
    train, test = rows('train.csv'), rows('test.csv')
    base = json.loads((CACHE / 'samples.json').read_text())
    used = {s['path'] for s in base}
    samples = [{**s, 'negativeGroup': None if s['supported'] else 'six-ten'} for s in base]
    for label in sorted({r['id_label'] for r in train}):
        if 20 <= label <= 24:
            continue
        training = sorted((r for r in train if r['id_label'] == label), key=number)
        if 25 <= label <= 29:
            picks = [(r, 'train', 'six-ten') for r in training if r['vid_path'] not in used]
        elif label % 2 == 0:
            picks = [(r, 'train', 'seen-class') for r in training[:3]] + [(r, 'calibration', 'seen-class') for r in training[3:5]]
            picks += [(r, 'test', 'seen-class') for r in test if r['id_label'] == label]
        else:
            picks = [(r, 'test', 'unseen-class') for r in test if r['id_label'] == label]
        samples += [{'path': r['vid_path'], 'datasetId': label, 'split': split, 'supported': False, 'negativeGroup': group} for r, split, group in picks]
    paths = [s['path'] for s in samples]
    if len(set(paths)) != len(paths):
        raise RuntimeError('Clip used twice.')
    if any(not p.startswith('clips/') or '..' in p.split('/') for p in paths):
        raise RuntimeError('Unexpected dataset path')
    with zipfile.ZipFile(CACHE / 'clips.zip') as archive:
        labels_by_hash, hash_of = {}, {}
        for info in archive.infolist():
            if info.filename.startswith('clips/') and info.filename.endswith('.MOV'):
                h = hashlib.sha256(archive.read(info.filename)).hexdigest()
                hash_of[info.filename] = h
                labels_by_hash.setdefault(h, set()).add(info.filename.split('/')[1])
        conflicting = sorted(p for p in paths if len(labels_by_hash[hash_of[p]]) > 1)
        seen, kept = set(), []
        for sample in samples:
            h = hash_of[sample['path']]
            if sample['path'] in conflicting or h in seen:
                continue
            seen.add(h)
            kept.append(sample)
        dropped = sorted(set(paths) - {s['path'] for s in kept})
        samples, paths = kept, [s['path'] for s in kept]
        for path in paths:
            destination = CACHE / path
            if not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(path))
    (CACHE / 'samples-extended.json').write_text(json.dumps(samples, indent=2) + '\n')
    count = lambda **kw: sum(all(s.get(k) == v for k, v in kw.items()) for s in samples)
    print(json.dumps({'samples': len(samples), 'droppedDuplicates': dropped,
                      'otherTrain': count(split='train', supported=False), 'negativeCalibration': count(split='calibration', supported=False),
                      'testSixTen': count(split='test', negativeGroup='six-ten'), 'testSeenClass': count(split='test', negativeGroup='seen-class'),
                      'testUnseenClass': count(split='test', negativeGroup='unseen-class')}, indent=2))


if __name__ == '__main__':
    main()
