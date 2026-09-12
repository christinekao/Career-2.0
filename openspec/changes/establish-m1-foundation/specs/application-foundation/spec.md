## Purpose

This capability provides the minimal offline local application foundation that
future Career 2.0 M1 changes can use without weakening privacy or ownership.

## ADDED Requirements

### Requirement: Application starts without a network dependency

The system SHALL start the local Career 2.0 application and expose its initial
workspace state without requiring network access, a server process, cloud
service, or background service.

#### Scenario: Application starts offline

- **WHEN** the user starts Career 2.0 while network access is unavailable
- **THEN** the application starts locally and reports its state without treating network absence as a product failure

### Requirement: Application uses one configured private root

The system SHALL accept one user-configured private data root outside the
source repository and SHALL use that root for foundation-managed state.

#### Scenario: Valid private root is configured

- **WHEN** the user provides a valid writable private root
- **THEN** the application initializes or opens foundation-managed state under that root and does not create a repository-local private-data fallback

#### Scenario: Private root cannot be used

- **WHEN** the configured private root is unset, unavailable, unreadable, or unsafe to write
- **THEN** the application fails closed with an explicit failure and does not report a successful state write

### Requirement: Canonical mutations have one application writer

The system SHALL route canonical structured-state and managed private-file
mutations through one local application writer boundary.

#### Scenario: Renderer requests a canonical mutation

- **WHEN** a local UI action changes canonical Career 2.0 state
- **THEN** the request crosses the application boundary and is handled by the one canonical writer rather than directly editing private storage

#### Scenario: No second writer is running

- **WHEN** the application is used in M1
- **THEN** no server, synchronizer, scheduler, agent runtime, or other background writer is required for canonical state

### Requirement: Foundation persistence can initialize and reopen

The system SHALL initialize the selected local structured-state store in the
configured private root and SHALL be able to reopen it deterministically after
the application is closed and started again.

#### Scenario: First local initialization

- **WHEN** the configured private root has no foundation-managed state
- **THEN** the application creates the minimum foundation state or reports a clear initialization failure without partial success

#### Scenario: Application restarts

- **WHEN** the user closes and reopens Career 2.0 with the same private root
- **THEN** the application reads the same foundation state and does not create a second canonical store

### Requirement: Foundation validation uses isolated synthetic roots

The system SHALL support deterministic foundation validation against isolated
synthetic private roots so tests do not read or write real career data.

#### Scenario: Foundation test runs

- **WHEN** an automated foundation check exercises initialization, writing, or failure handling
- **THEN** it uses an isolated synthetic root and leaves the user's private root and repository unchanged
