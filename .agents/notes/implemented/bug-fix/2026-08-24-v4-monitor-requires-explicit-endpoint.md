# Agent Note: V4 monitoring requires an explicit endpoint

Status: implemented

English | [中文](2026-08-24-v4-monitor-requires-explicit-endpoint.zh.md)

## Problem

The V4 monitoring plugin accepted an installation-specific public IP as its repository default. A fresh installation therefore inherited deployment metadata it did not choose, even though the empty invite code prevented authenticated requests.

## Decision

The `local-v4` monitor address and invite code both default to empty. The service performs no network request until both values are present, and users configure them through the plugin Settings surface. Existing local Settings continue to override the empty defaults.

## Alternatives considered

**Keep the endpoint and rely on the empty invite code.** This prevents authenticated polling, but still makes one deployment address part of every installation's configuration and leaves accidental traffic one credential edit away.

## Consequences

Fresh installations expose no monitoring destination or credential. Enabling the sidebar strip alone produces no traffic; the user must supply both connection values. Existing installations with both values stored continue polling without migration.
