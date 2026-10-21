#!/bin/sh
# Assemble rendered frames into docs/demo.gif with a shared palette.
set -e
dir=${1:-demo-frames}
out=${2:-docs/demo.gif}
ffmpeg -y -loglevel error -framerate 12 -i "$dir/f-%04d.png" -vf "scale=960:-1:flags=lanczos,palettegen=stats_mode=diff" "$dir/palette.png"
ffmpeg -y -loglevel error -framerate 12 -i "$dir/f-%04d.png" -i "$dir/palette.png" -lavfi "scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" "$out"
ls -lh "$out"
