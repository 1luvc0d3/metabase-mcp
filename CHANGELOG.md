# Changelog

## [2.0.1](https://github.com/1luvc0d3/metabase-mcp/compare/v2.0.0...v2.0.1) (2026-11-27)


### Bug Fixes

* include the blocked reason in SQL validation errors ([#97](https://github.com/1luvc0d3/metabase-mcp/issues/97)) ([d6510b4](https://github.com/1luvc0d3/metabase-mcp/commit/d6510b4f1efa7014c0c1d6131974a51696ac7a3a))

## [2.0.0](https://github.com/1luvc0d3/metabase-mcp/compare/v1.8.0...v2.0.0) (2026-11-18)


### ⚠ BREAKING CHANGES

* drop Node.js 20, require 22.12 or newer ([#93](https://github.com/1luvc0d3/metabase-mcp/issues/93))

### Build System

* drop Node.js 20, require 22.12 or newer ([#93](https://github.com/1luvc0d3/metabase-mcp/issues/93)) ([36e0e52](https://github.com/1luvc0d3/metabase-mcp/commit/36e0e524e5b71e86d15d1a993f3af061362966b3))

## [1.8.0](https://github.com/1luvc0d3/metabase-mcp/compare/v1.7.0...v1.8.0) (2026-11-17)


### Features

* add passthrough auth so each user brings their own Metabase credential ([#86](https://github.com/1luvc0d3/metabase-mcp/issues/86)) ([3738e26](https://github.com/1luvc0d3/metabase-mcp/commit/3738e26f2d84ee92b5c725478d7d04da98fe232f))
* throttle failed passthrough credential checks per client IP ([#88](https://github.com/1luvc0d3/metabase-mcp/issues/88)) ([0ade6d3](https://github.com/1luvc0d3/metabase-mcp/commit/0ade6d33847617f3ebd2dd5ae3fec12f05c96e8c))

## [1.7.0](https://github.com/1luvc0d3/metabase-mcp/compare/v1.6.1...v1.7.0) (2026-11-17)


### Features

* add Docker image for a shared multi-user HTTP server ([#84](https://github.com/1luvc0d3/metabase-mcp/issues/84)) ([2afbd4b](https://github.com/1luvc0d3/metabase-mcp/commit/2afbd4bc341cdaf7db7184e4ddd61b8b8f8420b2))

## [1.6.1](https://github.com/1luvc0d3/metabase-mcp/compare/v1.6.0...v1.6.1) (2026-11-16)


### Bug Fixes

* **client:** make execute_card parameters work ([#76](https://github.com/1luvc0d3/metabase-mcp/issues/76)) ([7aae8c6](https://github.com/1luvc0d3/metabase-mcp/commit/7aae8c640869176c34d1882a627d9755bbc62743))
* **client:** stop reporting successful deletes as failures ([#75](https://github.com/1luvc0d3/metabase-mcp/issues/75)) ([8f0d297](https://github.com/1luvc0d3/metabase-mcp/commit/8f0d2971acaf4a6348d1ec6d13b5516d3ff11f64))
* **deps:** bump express from 5.2.1 to 5.3.0 ([4b2c039](https://github.com/1luvc0d3/metabase-mcp/commit/4b2c039833ac1a143131f337bf491921b1e81e4f))
* **deps:** upgrade zod to v4 ([#73](https://github.com/1luvc0d3/metabase-mcp/issues/73)) ([07fc9bc](https://github.com/1luvc0d3/metabase-mcp/commit/07fc9bc90f70ae0d504c8ca058a57f8933db341f))

## [1.6.0](https://github.com/1luvc0d3/metabase-mcp/compare/v1.5.0...v1.6.0) (2026-11-16)


### Features

* Support METABASE_SESSION_TOKEN for authentication ([#56](https://github.com/1luvc0d3/metabase-mcp/issues/56)) ([7113d79](https://github.com/1luvc0d3/metabase-mcp/commit/7113d7908f93fefe66808f7ac8f6394c601182e5))
