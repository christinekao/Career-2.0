# Private Local Storage Specification

## Purpose

This baseline records approved target behavior for the current M1 scope. It
does not claim that the private storage boundary is implemented. Real Career
2.0 data is user-owned and remains outside the source repository.

## Requirements

### Requirement: Private data uses a configured root outside Git

The system SHALL use one user-configured private root outside the Career 2.0
repository for real structured state, source material, working files,
attachments, submitted snapshots, and backups.

#### Scenario: User configures a private root

- **WHEN** the application is given a valid private root
- **THEN** M1 canonical state and private bytes are stored or explicitly referenced under that root, not in the source repository

#### Scenario: Repository is inspected for private data

- **WHEN** the project is committed or validated
- **THEN** real private Career data is absent from Git; only source, contracts, sanitized evidence, and synthetic fixtures may be tracked

### Requirement: Canonical writes have one application owner

The system SHALL route canonical structured-state and managed-private-file
mutations through the Career 2.0 local application writer boundary.

#### Scenario: External editing changes a canonical file

- **WHEN** a canonical file or state store is edited outside the application
- **THEN** the change is detected or rejected rather than silently absorbed as a current truth

### Requirement: Private-root failure fails closed

The system SHALL fail closed when the configured private root is unset,
unavailable, unreadable, invalid, or cannot be safely written.

#### Scenario: Private storage is unavailable

- **WHEN** an operation requires private storage and the configured root cannot be used
- **THEN** the operation reports failure without falling back to the repository, browser storage, an alternate silent path, or partial success

### Requirement: File identity and missing state are explicit

The system SHALL distinguish copied bytes from external references and SHALL
track file identity with stable logical identity, size, media type, observed
availability, and SHA-256 when bytes are available.

#### Scenario: Referenced source file disappears

- **WHEN** an external source file is no longer available
- **THEN** its reference becomes explicitly missing and is not silently replaced by another file
