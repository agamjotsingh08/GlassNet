# GlassNet help

## How scanning works

GlassNet opens one public page in a fresh isolated browser, records request
destinations and safe storage metadata, classifies known services, then produces
a report. It does not submit forms or bypass website controls.

## What GlassNet collects

- Public request domains and resource types
- Cookie metadata such as domain and security attributes, never cookie values
- Local and session storage key names, never storage values
- Script source URLs

## Why results can differ

Websites may behave differently by time, location, consent choice, device,
experiments, and login state. A report describes one observed page load.

## Confidence

Verified means a matching rule identified a known service. Unknown means GlassNet
observed a third-party domain but does not make a stronger claim about its owner
or purpose.

## Delete local data

Stop GlassNet and delete `data/glassnet.sqlite`. This removes local accounts,
reports, feedback, and watch targets.
