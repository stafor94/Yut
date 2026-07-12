from pathlib import Path
import traceback

path = Path('.github/workflows/qa.yml')
status_path = Path('.patch-status')
error_path = Path('.patch-error')

jobs = [
    ('qa-online-flow', 'QA online flow', '20'),
    ('qa-roll-movement', 'QA roll and movement', '25'),
    ('qa-lobby-desktop', 'QA desktop lobby', '15'),
    ('qa-mobile-layout', 'QA mobile and tablet layout', '15'),
]

try:
    text = path.read_text(encoding='utf-8')
    patched_headers = []
    for job_id, job_name, timeout in jobs:
        old = (
            f'  {job_id}:\n'
            f'    name: {job_name}\n'
            '    needs: deploy-pages\n'
            '    runs-on: ubuntu-latest\n'
            f'    timeout-minutes: {timeout}\n'
            '    container:\n'
        )
        new = (
            f'  {job_id}:\n'
            f'    name: {job_name}\n'
            '    needs: deploy-pages\n'
            '    runs-on: ubuntu-latest\n'
            f'    timeout-minutes: {timeout}\n'
            '    defaults:\n'
            '      run:\n'
            '        shell: bash\n'
            '    container:\n'
        )
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f'{job_id}: expected one target header, found {count}')
        text = text.replace(old, new, 1)
        patched_headers.append(new)

    for job_id, header in zip((job[0] for job in jobs), patched_headers):
        count = text.count(header)
        if count != 1:
            raise RuntimeError(f'{job_id}: expected one patched header, found {count}')

    if text.count('        shell: bash\n') < 4:
        raise RuntimeError('expected at least four Bash job defaults')
    if text.count('set -o pipefail') < 8:
        raise RuntimeError('expected QA and cleanup pipefail commands are missing')

    path.write_text(text, encoding='utf-8')
    status_path.write_text('ok\n', encoding='utf-8')
    error_path.unlink(missing_ok=True)
except Exception:
    status_path.write_text('failed\n', encoding='utf-8')
    error_path.write_text(traceback.format_exc(), encoding='utf-8')
