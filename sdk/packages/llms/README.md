# @cline/llms

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/llms` remains the canonical source for model/provider cataloging and provider settings schema.

## Runtime entrypoints

- Default package entrypoint: `@cline/llms`
- Node/runtime explicit entrypoint: `@cline/llms/node`

The default export map resolves to a browser-safe bundle under browser/react-server conditions, and to the Node runtime bundle under standard Node import conditions.

Vertex Claude routing in the Node runtime uses `@ai-sdk/google-vertex/anthropic`.
