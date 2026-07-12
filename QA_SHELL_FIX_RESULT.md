# QA shell fix result

- patch: failed
- npm ci: 99
- unit: 99
- build: 99

## .patch-error
```text
Traceback (most recent call last):
  File "/home/runner/work/Yut/Yut/scripts/fix-qa-playwright-shell-v2.py", line 16, in <module>
    text = path.read_text(encoding='utf-8')
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.12/pathlib.py", line 1029, in read_text
    with self.open(mode='r', encoding=encoding, errors=errors) as f:
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.12/pathlib.py", line 1015, in open
    return io.open(self, mode, buffering, encoding, errors, newline)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: '.github/workflows/qa.yml'
```
