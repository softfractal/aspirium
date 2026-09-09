#!/bin/sh
# Web fonts for the coming-soon page. Sources come from dev/fetch-fonts.sh (Literata, Source Serif 4)
# and from the project's own type lane (ASPIRIUM). All three are SIL OFL 1.1, so all three are free
# for commercial use and web embedding, and all three ship their licence text alongside the files.
#
#  · ASPIRIUM Light  — display only: labels, the submit control, the footer. The rev 8 CAL build from
#    delivery/ASPIRIUM v1, subset to Latin. Swap when the Code lane ships the calibrated family.
#  · Literata        — the lockup, now live text rather than a PNG (Eric, 2026-09-09). Variable
#    opsz 7..72 / wght 200..900, so one file covers every size and weight the page asks for.
#  · Source Serif 4  — body and UI (Eric, 2026-09-09). Variable opsz 8..60 / wght 200..900. The
#    designed sibling of the Source Code Pro that ASPIRIUM is cut from, so the page keeps two voices.
#    Reserved Font Name "Source": shipped unmodified, which is what the RFN requires.
#
# Source Code Pro is no longer built — it was the provisional body face and Source Serif 4 replaces it.
set -e
cd "$(dirname "$0")/.."
TF="../Vectors/Type Face"
SUB="$TF/.venv/bin/pyftsubset"
PY="$TF/.venv/bin/python"
LATIN="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+2044,U+20AC"
mkdir -p assets/fonts

# display face — static instance, one weight
"$SUB" "$TF/delivery/ASPIRIUM v1/ASPIRIUM-Light.ttf" \
  --unicodes="$LATIN" --layout-features='*' --name-IDs='*' --flavor=woff2 \
  --output-file=assets/fonts/ASPIRIUM-Light.woff2
cp -f "$TF/delivery/ASPIRIUM v1/OFL-LICENSE.md" assets/fonts/OFL-LICENSE-ASPIRIUM.md

# variable faces — axes preserved, so font-optical-sizing and any weight work from one file each
"$SUB" "dev/font-src/Literata[opsz,wght].ttf" \
  --unicodes="$LATIN" --layout-features='*' --name-IDs='*' --flavor=woff2 \
  --output-file=assets/fonts/Literata-var.woff2
cp -f dev/font-src/OFL-Literata.txt assets/fonts/OFL-LICENSE-Literata.txt

# Source Serif sets body copy at one size, so its optical-size axis is pinned at the default (20)
# and only weight stays variable: 190 KB -> 75 KB, which matters on the cellular traffic the brief
# expects. Literata keeps both axes because the lockup runs from ~24 px to ~64 px in one composition.
"$PY" -m fontTools.varLib.instancer "dev/font-src/SourceSerif4[opsz,wght].ttf" opsz=drop \
  -o dev/font-src/.SourceSerif4-wght.ttf >/dev/null
"$SUB" dev/font-src/.SourceSerif4-wght.ttf \
  --unicodes="$LATIN" --layout-features='*' --name-IDs='*' --flavor=woff2 \
  --output-file=assets/fonts/SourceSerif4-var.woff2
rm -f dev/font-src/.SourceSerif4-wght.ttf
cp -f dev/font-src/OFL-SourceSerif4.txt assets/fonts/OFL-LICENSE-SourceSerif4.txt

# Italic is not referenced by the page today; add it here the day body copy needs one:
#   "$SUB" "dev/font-src/SourceSerif4-Italic[opsz,wght].ttf" --unicodes="$LATIN" \
#     --layout-features='*' --name-IDs='*' --flavor=woff2 --output-file=assets/fonts/SourceSerif4-Italic-var.woff2

rm -f assets/fonts/SourceCodePro-Regular.ttf assets/fonts/OFL-LICENSE-SourceCodePro.md
ls -la assets/fonts
