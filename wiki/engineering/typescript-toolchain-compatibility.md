# TypeScript toolchain compatibility

`typescript-eslint@8.66.0` declares a peer range of `>=4.8.4 <6.1.0`, so
TypeScript 7 cannot be installed with the repository's current lint toolchain
under npm's strict peer-dependency resolution. The resolved TypeScript target is
6.0.3, the newest compatible release; revisit this pin when a
`typescript-eslint` release supports TypeScript 7.

Related: [[engineering/quality-gate|quality gate]] and [[engineering/scaffold-decisions|scaffold decisions]].

[engineering/quality-gate|quality gate]: quality-gate.md
[engineering/scaffold-decisions|scaffold decisions]: scaffold-decisions.md
