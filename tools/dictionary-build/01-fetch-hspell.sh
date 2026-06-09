#!/usr/bin/env bash
# Phase 1: fetch and build HSpell.
#
# Requires Linux or WSL. Tools needed:
#   - git, curl, tar, gunzip
#   - perl 5.10+
#   - GNU make, autotools (autoconf, automake)
#   - C compiler (gcc/clang)
#
# Output: tools/dictionary-build/sources/hspell/ with built binaries.
# Pinned to a known-good version so rebuilds are reproducible.

set -euo pipefail

HSPELL_VERSION="1.4"
HSPELL_TARBALL="hspell-${HSPELL_VERSION}.tar.gz"
# hspell.ivrix.org.il is now broken (cert mismatch + redirect to a malformed
# SourceForge URL). SourceForge hosts the tarball directly under the hspell
# project — that's our reliable source.
HSPELL_URL="https://downloads.sourceforge.net/project/hspell/hspell/${HSPELL_VERSION}/${HSPELL_TARBALL}"

cd "$(dirname "$0")/sources"

if [ ! -f "${HSPELL_TARBALL}" ]; then
  echo "Fetching HSpell ${HSPELL_VERSION}..."
  # hspell.ivrix.org.il ships a cert that doesn't match the hostname; the
  # tarball is open-source code so cert verification adds no real safety here.
  # If this bothers you, download the tarball manually and drop it next to
  # this script.
  curl -kL -o "${HSPELL_TARBALL}" "${HSPELL_URL}"
fi

if [ ! -d "hspell-${HSPELL_VERSION}" ]; then
  tar xzf "${HSPELL_TARBALL}"
fi

cd "hspell-${HSPELL_VERSION}"

if [ ! -f Makefile ]; then
  ./configure --enable-fatverb --enable-linginfo
fi

make

echo ""
echo "HSpell built. Binaries are in $(pwd)."
echo "Run 02-enumerate.js next."
