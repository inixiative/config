# Widgets: Warden knowledge (repo)

<!-- Region `widgets`; concepts: widgets. Fixture written with the region builder's units.py and assemble.py. Edit the sources, not this file. -->

**Routing:** Is this about widgets?

## Contents

## Glossary

## 1. What this Warden covers

The widgets region.

## 2. The domain

Fixture prose.

## 3. Everything that exists here, by class

## 4. The specifics, in full

### 4a. Doc sections

Each unit is the doc section verbatim, with its headings shifted down two levels. A source line above it gives the path, the section and the doc's H1.

<!-- unit doc:README.md#preface -->
**Source:** `README.md` § (preface) (in "Widgets")

### Widgets

A widget library. This preface is long enough to be its own unit: the region builder keeps a preface only when it holds forty tokens or more, about one hundred and sixty characters.

<!-- unit doc:README.md#usage -->
**Source:** `README.md` § Usage (in "Widgets")

#### Usage

Make a widget with `createWidget`:

```ts
# not a heading inside a fence
createWidget({ size: 2 });
```

##### Options

`size` is the widget's size.

<!-- unit doc:README.md#errors -->
**Source:** `README.md` § Errors (in "Widgets")

#### Errors

`WidgetError` is thrown for a bad size.

### 4b. Code entries

From the catalog (extracted from the code, described by a model). Each line: **name** `where` [kind] the job it does. Use: canonical usage.
