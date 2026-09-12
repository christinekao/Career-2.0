# Opportunity Workspace Specification

## Purpose

This baseline records approved target behavior for the current M1 scope. It
does not claim that the Opportunity workspace is implemented. An Opportunity
is the center of the user's job workflow.

## Requirements

### Requirement: Opportunity is the workflow center

The system SHALL represent a job opportunity as the shared context for its
company, role, location, source URLs, job-description captures, application
state, interactions, interviews, documents, and next actions.

#### Scenario: User starts with a job description

- **WHEN** the user provides a company, role, and job-description text
- **THEN** the system can save one Opportunity without requiring a complete Career Profile or Career Evidence library

#### Scenario: User returns to an Opportunity

- **WHEN** the user opens an existing Opportunity
- **THEN** the system presents the current status, next action, recent history, and the materials associated with that Opportunity

### Requirement: Job-description captures are historical revisions

The system SHALL preserve each captured job-description text and its source
metadata as a distinct revision rather than overwriting an earlier capture.

#### Scenario: User pastes an updated job description

- **WHEN** the user records a newer job-description capture
- **THEN** the new capture is current while the earlier capture remains available for historical reference

#### Scenario: Source text is unavailable

- **WHEN** an Opportunity has only a URL or a previously referenced source file is missing
- **THEN** the system preserves the Opportunity and marks the unavailable text as unknown rather than inventing or silently substituting content

### Requirement: Opportunity workflow remains lightweight

The system SHALL support explicit application state and next-action updates
without requiring a lead-scoring, contact-pipeline, campaign, automation, or
full CRM subsystem.

#### Scenario: User reschedules a next action

- **WHEN** the user changes the date or completion state of a next action
- **THEN** the current Opportunity view and its history reflect the explicit change
