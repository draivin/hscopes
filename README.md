# HyperScopes

A meta-extension for vscode that provides TextMate scope information. Its
intended usage is as a library for other extensions to query scope information.

## Usage

This extension provides an API by which your extension can query scope & token
information. Refer to `hscopes.d.ts` and `extension.test.ts` for more details.
Example usage:

```ts
import * as vscode from 'vscode';
import * as scopeInfo from 'scope-info';

async function example(doc : vscode.TextDocument, pos: vscode.Position) : void {
  const hs = vscode.extensions.getExtension<scopeInfo.ScopeInfoAPI>('draivin.hscopes');
  const token : scopeInfo.Token = hs.getScopeAt(doc, pos);
}
```
