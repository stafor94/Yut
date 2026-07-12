# QA shell fix result

- patch: failed
- npm ci: 99
- unit: 99
- build: 99

## .patch-error
```text
Traceback (most recent call last):
  File "/home/runner/work/Yut/Yut/scripts/fix-qa-playwright-shell.py", line 48, in <module>
    raise RuntimeError(f'{job_id}: Bash defaults missing after patch')
RuntimeError: qa-online-flow: Bash defaults missing after patch
```
