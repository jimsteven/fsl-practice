"""Select FSL-105 v2 clips for the experimental continuous-signing vocabulary.

Vocabulary signs (src/vocab.js): first 12 original training clips by filename
train, the remaining training clips calibrate, original test clips evaluate.
Every other sign is "other": even dataset IDs give 3 train + 1 calibrate clips;
odd IDs give 2 original test clips only, so rejection is also measured on signs
never used in training ("unseen-class"). Byte-identical clips filed under
different labels are dropped everywhere; same-label copies keep the first.
Reads only the SHA-256 verified local clips.zip and CSVs from setup-content.py.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.tools' / 'fsl105'
ARCHIVE_SHA = 'c048c0820be1621101dfedeabb76a9fbfca76ed2868eebe23b4cb90d5c748463'
VOCAB = [int(n) for n in re.findall(r'\[(\d+), ', (ROOT / 'src' / 'vocab.js').read_text().split('export const VOCAB = [')[1].split('].map')[0])]


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
    if len(VOCAB) != 25:
        raise RuntimeError('Could not read the vocabulary from src/vocab.js')
    if digest(CACHE / 'clips.zip') != ARCHIVE_SHA:
        raise RuntimeError('clips.zip is missing or changed; run npm run setup:content first.')
    train, test = rows('train.csv'), rows('test.csv')
    samples = []
    for label in sorted({r['id_label'] for r in train}):
        training = sorted((r for r in train if r['id_label'] == label), key=number)
        testing = sorted((r for r in test if r['id_label'] == label), key=number)
        if label in VOCAB:
            picks = [(r, 'train' if i < 12 else 'calibration') for i, r in enumerate(training)] + [(r, 'test') for r in testing]
            group = 'vocab'
        elif label % 2 == 0:
            picks = [(r, 'train') for r in training[:3]] + [(r, 'calibration') for r in training[3:4]] + [(r, 'test') for r in testing[:2]]
            group = 'seen-class'
        else:
            picks = [(r, 'test') for r in testing[:2]]
            group = 'unseen-class'
        samples += [{'path': r['vid_path'], 'datasetId': label, 'split': split, 'vocab': label in VOCAB, 'group': group} for r, split in picks]
    with zipfile.ZipFile(CACHE / 'clips.zip') as archive:
        labels_by_hash, hash_of = {}, {}
        for info in archive.infolist():
            if info.filename.startswith('clips/') and info.filename.endswith('.MOV'):
                h = hashlib.sha256(archive.read(info.filename)).hexdigest()
                hash_of[info.filename] = h
                labels_by_hash.setdefault(h, set()).add(info.filename.split('/')[1])
        seen, kept = set(), []
        for s in samples:
            h = hash_of[s['path']]
            if len(labels_by_hash[h]) > 1 or h in seen:
                continue
            seen.add(h)
            kept.append(s)
        for s in kept:
            destination = CACHE / s['path']
            if not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(s['path']))
    dropped = sorted({s['path'] for s in samples} - {s['path'] for s in kept})
    (CACHE / 'vocab-samples.json').write_text(json.dumps(kept, indent=2) + '\n')
    count = lambda **kw: sum(all(s.get(k) == v for k, v in kw.items()) for s in kept)
    print(json.dumps({'samples': len(kept), 'droppedDuplicates': dropped,
                      'vocabTrain': count(vocab=True, split='train'), 'vocabCalibration': count(vocab=True, split='calibration'), 'vocabTest': count(vocab=True, split='test'),
                      'otherTrain': count(vocab=False, split='train'), 'otherCalibration': count(vocab=False, split='calibration'),
                      'otherTestSeen': count(group='seen-class', split='test'), 'otherTestUnseen': count(group='unseen-class', split='test')}, indent=2))


if __name__ == '__main__':
    main()
