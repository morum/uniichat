#!/usr/bin/env python3
# Mutacoes de validacao e de mascaramento em DeviceEnv.ts.
# Cada uma troca um trecho e roda DeviceEnv.test.ts.
# Morta: o teste falha. Sobreviveu: o teste passa.
# O arquivo volta ao original no fim. Nada usa pkill.

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "DeviceEnv.ts"
BAK = SRC.read_text()

# (id, trecho, trecho mutado)
MUDS = [
    ("M1", "const upper = name.toUpperCase();", "const upper = name;"),
    ("M2", 'if (upper === "PATH")', 'if (upper === "PATHX")'),
    ("M3", 'if (upper === "HOME")', 'if (upper === "HOMEX")'),
    ("M4", 'if (upper.startsWith("UNII_"))', 'if (upper.startsWith("UNII_X"))'),
    ("M5", 'upper.startsWith("SYSTEMD_")', 'upper.startsWith("SYSTEMD_X")'),
    ("M6", 'upper.startsWith("LISTEN_")', 'upper.startsWith("LISTEN_X")'),
    ("M7", "SYSTEMD.has(upper)", 'SYSTEMD.has("NONE")'),
    ("M8", "name.length > NAME_MAX", "false"),
    ("M9", "!NAME_RE.test(name)", "false"),
    ("M10", r'value.includes("\0")', "false"),
    ("M11", "value.length > VALUE_MAX", "false"),
    ("M12", "plain.length >= MASK", "plain.length >= 0"),
    ("M13", "plain.slice(-TAIL)", "plain"),
    ("M14", "if (DeviceEnv.why(name) !== null || DeviceEnv.why_value(next[name]) !== null)", "if (false)"),
    ("M15", "if (prev === undefined) delete env[name];", "if (false) delete env[name];"),
]

def main() -> int:
    bad = 0
    try:
        for mid, old, new in MUDS:
            if BAK.count(old) != 1:
                print(f"{mid} NAO ACHOU ({BAK.count(old)})")
                bad += 1
                continue
            SRC.write_text(BAK.replace(old, new, 1))
            run = subprocess.run(
                ["bun", "test", "DeviceEnv.test.ts"],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if run.returncode == 0:
                print(f"{mid} SOBREVIVEU")
                bad += 1
            else:
                print(f"{mid} morreu")
    finally:
        SRC.write_text(BAK)
    died = len(MUDS) - bad
    print(f"morreu {died}, sobreviveu {bad}, de {len(MUDS)}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
