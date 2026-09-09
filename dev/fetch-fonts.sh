#!/bin/sh
# Downloads the upstream OFL sources for the two licensed-free web faces into dev/font-src/.
# Run once; dev/build-fonts.sh subsets what this leaves behind. Both families are SIL OFL 1.1:
# free for commercial use and web embedding, never sellable on their own, and the licence text
# must travel with the files (build-fonts.sh copies it into assets/fonts/).
#   Literata        — googlefonts/literata, TypeTogether. The lockup's face.
#   Source Serif 4  — adobe-fonts/source-serif. Body and UI; the designed sibling of the
#                     Source Code Pro that ASPIRIUM is cut from. Reserved Font Name "Source":
#                     usable as shipped, but a MODIFIED copy may not keep the name.
set -e
cd "$(dirname "$0")"
mkdir -p font-src
RAW=https://raw.githubusercontent.com/google/fonts/main/ofl
get() { curl -sSL -m 120 -o "font-src/$2" "$RAW/$1"; printf '  %-34s %8d bytes\n' "$2" "$(wc -c < "font-src/$2")"; }
get "literata/Literata%5Bopsz,wght%5D.ttf"            "Literata[opsz,wght].ttf"
get "literata/OFL.txt"                                "OFL-Literata.txt"
get "sourceserif4/SourceSerif4%5Bopsz,wght%5D.ttf"    "SourceSerif4[opsz,wght].ttf"
get "sourceserif4/SourceSerif4-Italic%5Bopsz,wght%5D.ttf" "SourceSerif4-Italic[opsz,wght].ttf"
get "sourceserif4/OFL.txt"                            "OFL-SourceSerif4.txt"
