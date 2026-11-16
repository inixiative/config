# Widgets

A widget library. This preface is long enough to be its own unit: the region builder keeps a preface only when it holds forty tokens or more, about one hundred and sixty characters.

## Contents

- [Usage](#usage)

## Usage

Make a widget with `createWidget`:

```ts
# not a heading inside a fence
createWidget({ size: 2 });
```

### Options

`size` is the widget's size.

## Errors

`WidgetError` is thrown for a bad size.
