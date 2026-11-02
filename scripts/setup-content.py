"""Build attributed local references and explicit clip-disjoint research splits.

Downloads only the documented CC BY FSL-105 v2 artifacts; never executes upstream code.
Requires a local ffmpeg executable for audio-free H.264 references.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import struct
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.tools' / 'fsl105'
PUBLIC = ROOT / 'public' / 'references'
BASE = 'https://data.mendeley.com/public-files/datasets/48y2y99mb9/files/'
FILES = {
    'clips.zip': ('d36a06e8-03f1-40bf-930e-1ada88d768e8', 'c048c0820be1621101dfedeabb76a9fbfca76ed2868eebe23b4cb90d5c748463'),
    'labels.csv': ('4f6cd423-ffee-418c-85a6-c68470e95a9b', '6074947fc905eecf20a341388551aeab0b32341928778a1f87d6c3bca073b630'),
    'train.csv': ('6a41ed97-ef54-4145-b575-44bd26b8a128', '861a76cae835e284ac76ef37dc077ae0b6c793beb9c378eda1fce5f408dc609f'),
    'test.csv': ('3edb836e-7bf6-4fc8-9b1e-4a6b66b3aadc', '3dd8e83294a63b7c02fd1ee3ebd1d179aa4b0437ff9cfb3febab5d0e1da0ccf7'),
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch_clips(wanted):
    archive_path = CACHE / 'clips.zip'
    if archive_path.exists():
        if digest(archive_path) != FILES['clips.zip'][1]:
            raise RuntimeError('Incomplete or changed cached archive; finish the download before using it.')
        with zipfile.ZipFile(archive_path) as archive:
            for path in wanted:
                destination = CACHE / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(path))
        return 'Full archive SHA-256 and ZIP CRC verified'
    # The original archive supports HTTP ranges. Fetch only this subset instead
    # of downloading 379 MB. TLS + ZIP CRC protect transport; output SHA-256s
    # are recorded below. Do not claim the entire archive hash was verified.
    total = 379081783
    tail_size = 200000
    def curl_range(url, start, length):
        output = subprocess.run(['curl', '-fLsS', '--retry', '2', '--max-time', '90', '--max-filesize', str(length), '--range', '%d-%d' % (start, start + length - 1), '-w', '\n%{http_code}\n%{url_effective}', url], check=True, stdout=subprocess.PIPE).stdout
        payload, status, final_url = output.rsplit(b'\n', 2)
        if status != b'206' or len(payload) != length:
            raise RuntimeError('Dataset server did not honor byte ranges')
        return payload, final_url.decode()

    tail, download_url = curl_range(BASE + FILES['clips.zip'][0] + '/file_downloaded', total - tail_size, tail_size)
    with zipfile.ZipFile(io.BytesIO(tail)) as directory:
        entries = {path: directory.getinfo(path) for path in wanted}

    def read_range(start, length):
        return curl_range(download_url, start, length)[0]

    def fetch(path):
        info = entries[path]
        offset = info.header_offset + total - tail_size
        header = read_range(offset, 30)
        fields = struct.unpack('<4s5H3L2H', header)
        if fields[0] != b'PK\x03\x04' or fields[2] & 1:
            raise RuntimeError('Unexpected/encrypted ZIP entry')
        payload = read_range(offset + 30 + fields[-2] + fields[-1], info.compress_size)
        if info.compress_type == zipfile.ZIP_DEFLATED:
            payload = zlib.decompress(payload, -15)
        elif info.compress_type != zipfile.ZIP_STORED:
            raise RuntimeError('Unsupported compression')
        if len(payload) != info.file_size or zlib.crc32(payload) != info.CRC:
            raise RuntimeError('Clip size/CRC mismatch: ' + path)
        destination = CACHE / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, sorted(wanted)))
    return 'Selected original entries fetched over HTTPS; ZIP CRC checked; full archive SHA-256 not checked by this range run'


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name, (file_id, sha) in FILES.items():
        if name == 'clips.zip':
            continue
        path = CACHE / name
        if not path.exists():
            print('Downloading', name, flush=True)
            subprocess.run(['curl', '-fLsS', '--retry', '2', '--max-filesize', '100000', BASE + file_id + '/file_downloaded', '-o', str(path)], check=True)
        if digest(path) != sha:
            raise RuntimeError('Dataset checksum mismatch: ' + name)
    train = list(csv.DictReader(io.StringIO((CACHE / 'train.csv').read_text(encoding='utf-8-sig'))))
    test = list(csv.DictReader(io.StringIO((CACHE / 'test.csv').read_text(encoding='utf-8-sig'))))
    if {r['vid_path'] for r in train} & {r['vid_path'] for r in test}:
        raise RuntimeError('Source train/test overlap')
    samples = []
    reference_paths = {}
    for label in range(30):
        training = sorted((r for r in train if int(r['id_label']) == label), key=lambda r: int(r['vid_path'].replace('\\', '/').split('/')[-1].split('.')[0]))
        reference_paths[label] = training[0]['vid_path'].replace('\\', '/')
        if 20 <= label <= 29:
            for i, row in enumerate(training):
                # Positives: 12 train + 4 calibration per class; negatives: 4 calibration.
                if label > 24 and i >= 4:
                    continue
                samples.append({'path': row['vid_path'].replace('\\', '/'), 'datasetId': label, 'split': 'train' if label <= 24 and i < 12 else 'calibration', 'supported': label <= 24})
            for row in test:
                if int(row['id_label']) == label:
                    samples.append({'path': row['vid_path'].replace('\\', '/'), 'datasetId': label, 'split': 'test', 'supported': label <= 24})
    wanted = set(reference_paths.values()) | {s['path'] for s in samples}
    if any(not path.startswith('clips/') or '..' in path.split('/') for path in wanted):
        raise RuntimeError('Unexpected dataset path')
    integrity = fetch_clips(wanted)
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('Install/use a reviewed local ffmpeg, then rerun. Dataset remains cached.')
    assets = []
    for label, path in reference_paths.items():
        output = PUBLIC / ('fsl105-%d.mp4' % label)
        subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(CACHE / path), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(output)], check=True)
        assets.append({'datasetId': label, 'sourceClip': path, 'sha256': digest(output), 'path': '/references/' + output.name})
    (CACHE / 'samples.json').write_text(json.dumps(samples, indent=2) + '\n')
    (PUBLIC / 'provenance.json').write_text(json.dumps({'dataset': 'FSL-105 v2', 'doi': '10.17632/48y2y99mb9.2', 'author': 'Isaiah Jassen Tupal, 2023', 'license': 'CC BY 4.0', 'source': 'https://data.mendeley.com/datasets/48y2y99mb9/2', 'publishedArchiveSha256': FILES['clips.zip'][1], 'integrity': integrity, 'modifications': 'Reference videos re-encoded to H.264/yuv420p, audio removed; display labels normalized. No expert endorsement of this app or classifier.', 'signerSplit': 'Unavailable: original CSVs have no signer identifiers. Splits are clip-disjoint only.', 'sourceClips': [{'path': path, 'sha256': digest(CACHE / path)} for path in sorted(wanted)], 'assets': assets}, indent=2) + '\n')
    shutil.copyfile(CACHE / 'labels.csv', PUBLIC / 'labels.csv')
    print('Prepared %d references and %d research samples.' % (len(assets), len(samples)))


if __name__ == '__main__':
    main()
