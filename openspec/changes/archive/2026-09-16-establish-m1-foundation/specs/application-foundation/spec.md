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

#### Scenario: A pre-existing foundation state path is unsafe

- **WHEN** `.career2` or a foundation lock, database, or SQLite sidecar is already a symlink or hard link, or canonical path validation resolves it outside the configured private root
- **THEN** initialization fails closed before writing through the unsafe path, and the outside target receives no lock, database, or other foundation state through normal pathname resolution

**M1 threat-model boundary:** An adversarial same-OS-user replacement of the `.career2` directory inode or symlink between a successful validation check and the filesystem open syscall is out of scope. M1 does not prevent or claim to prevent this path-swap race; retain it as a skipped future-hardening fixture. This exclusion does not relax rejection of pre-existing unsafe paths or fail-closed behavior when path/identity validation observes an anomaly.

#### Scenario: Runtime configuration contains no career data

- **WHEN** the application persists the selected root or other non-sensitive runtime configuration
- **THEN** it stores no career records, source material, attachments, generated content, or submitted bytes in that configuration or in the repository

### Requirement: Canonical mutations have one application writer

The system SHALL route canonical structured-state and managed private-file
mutations through one local application writer boundary. For a given
configured private root, only one Career 2.0 application process may own
canonical-write access at a time. Direct editing of managed state outside
Career 2.0 is unsupported; this requirement does not claim to prevent
arbitrary external tools from modifying user-owned files or SQLite bytes.

#### Scenario: Renderer requests a canonical mutation

- **WHEN** a local UI action changes canonical Career 2.0 state
- **THEN** the request crosses the application boundary and is handled by the one canonical writer rather than directly editing private storage

#### Scenario: Second Career 2.0 instance requests the same private root

- **WHEN** a second Career 2.0 application process attempts to use a configured private root whose canonical-write ownership is already active
- **THEN** it cannot acquire canonical-write ownership, does not perform canonical writes, and reports an explicit ownership conflict

#### Scenario: Different private roots operate independently

- **WHEN** two Career 2.0 application processes target different valid private roots
- **THEN** each can independently acquire its root's canonical-write ownership and activity for one root does not grant access to or block the other root

#### Scenario: Ownership is released after clean shutdown

- **WHEN** the process that owns a private root shuts down cleanly
- **THEN** ownership is released and a subsequent valid process can acquire that same root

#### Scenario: Ownership recovers after abnormal termination

- **WHEN** a previous owner terminated abnormally and a new process attempts to acquire the same private root
- **THEN** stale ownership or a stale recovery claim does not permanently block recovery, ownership is granted only when no active competing writer exists, and uncertainty fails closed

#### Scenario: Two processes contend to recover the same stale owner

- **WHEN** two processes simultaneously attempt to recover one stale ownership generation
- **THEN** at most one process acquires ownership and initializes the store, the other fails before persistence initialization, and neither can remove or replace the winner's valid ownership

#### Scenario: No second writer is running

- **WHEN** the application is used in M1
- **THEN** no server, synchronizer, scheduler, agent runtime, or other background writer is required for canonical state

### Requirement: Foundation persistence can initialize and reopen

The system SHALL initialize the selected local structured-state store in the
configured private root and SHALL be able to reopen it deterministically after
the application is closed and started again.

#### Scenario: First local initialization

- **WHEN** the configured private root has no foundation-managed state
- **THEN** the application creates exactly one usable foundation state with its minimum identity, supported-version, and ready metadata, or reports a clear initialization failure without partial success

#### Scenario: Application restarts

- **WHEN** the user closes and reopens Career 2.0 with the same private root
- **THEN** the application reads the same foundation state and does not create a second canonical store

#### Scenario: Foundation initialization is repeated

- **WHEN** foundation initialization runs again for a private root that already has a valid foundation store
- **THEN** the same logical store identity and supported version are reused, initialization succeeds deterministically, and existing foundation state is not reset, replaced, or duplicated

#### Scenario: Foundation store version is unsupported

- **WHEN** the application attempts to open a foundation store with a newer, unsupported, or incompatible version
- **THEN** the store is not reported as ready, no destructive migration, reset, downgrade, replacement, or rebinding occurs, and the application returns an explicit failure

#### Scenario: Foundation initialization fails before ready

- **WHEN** foundation initialization fails before its ready state is published and initialization is retried
- **THEN** the first attempt is not reported as successful, invalid partial state is not treated as a valid foundation store, and the retry has deterministic behavior without requiring unsafe manual mutation

#### Scenario: Ownership is checked through ready publication

- **WHEN** ownership is lost during foundation initialization
- **THEN** the store is not published as ready or returned to the caller

#### Scenario: Caller receives the narrow persistence boundary

- **WHEN** foundation initialization succeeds
- **THEN** the caller receives metadata and a lifecycle close operation only, not a raw SQLite handle or database path

### Requirement: Foundation validation uses isolated synthetic roots

The system SHALL support deterministic foundation validation against isolated
synthetic private roots so tests do not read or write real career data.

#### Scenario: Foundation test runs

- **WHEN** an automated foundation check exercises initialization, writing, or failure handling
- **THEN** it uses an isolated synthetic root and leaves the user's private root and repository unchanged
