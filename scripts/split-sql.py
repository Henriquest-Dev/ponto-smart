"""Divide um ficheiro SQL de INSERTs em partes pequenas (para o SQL Editor do Supabase).
Uso: python3 scripts/split-sql.py <entrada.sql> <prefixo-saida> [max_kb]"""
import re
import sys

src, prefix = sys.argv[1], sys.argv[2]
max_bytes = int(sys.argv[3] if len(sys.argv) > 3 else 400) * 1024
text = open(src, encoding="utf-8").read()
header = text.split("BEGIN;", 1)[0].strip()
body = text.split("BEGIN;", 1)[1].rsplit("COMMIT;", 1)[0]
statements = [s.strip() for s in re.split(r"\n(?=INSERT INTO )", body) if s.strip().startswith("INSERT INTO")]

parts, current, size = [], [], 0
for st in statements:
    n = len(st.encode("utf-8"))
    if current and size + n > max_bytes:
        parts.append(current)
        current, size = [], 0
    current.append(st)
    size += n
if current:
    parts.append(current)

for i, chunk in enumerate(parts, 1):
    with open(f"{prefix}_parte{i}.sql", "w", encoding="utf-8") as f:
        f.write(f"{header}\n-- Parte {i} de {len(parts)} — executar por ordem.\n\nBEGIN;\n")
        f.write("\n\n".join(chunk))
        f.write("\n\nCOMMIT;\n")
print(f"{len(statements)} instruções em {len(parts)} partes")
