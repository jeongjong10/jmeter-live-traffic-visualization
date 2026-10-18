# NetViz attribution

This directory is an integration-derived work based on [hoodini/netviz](https://github.com/hoodini/netviz), commit `9b084414a06303a4837536ffb60cde5621107cfb` (retrieved 2026-10-18).

The original repository's React, TypeScript, Vite, Tailwind, Canvas topology, request list, inspector, waterfall, and statistics UI structure are retained and adapted here to consume local JMeter collector events. The upstream repository did not contain a `LICENSE` file and GitHub's license endpoint returned no declared repository license when this integration was made. No license is asserted for the upstream work by this project; keep this attribution with derived files and obtain the upstream author's permission before redistribution beyond this local PoC.

Project-specific additions replace upstream browser interception and public demo traffic with a loopback-only collector adapter and recording replay.
