import * as vscode from 'vscode';
import * as textUtil from './text-util';
import * as api from './hscopes';
import * as tm from 'vscode-textmate';

export class DocumentController implements vscode.Disposable {
  private subscriptions: vscode.Disposable[] = [];

  // Stores the state for each line
  private grammarState: tm.StateStack[] = [];
  private grammar: tm.IGrammar;

  public constructor(
    doc: vscode.TextDocument,
    textMateGrammar: tm.IGrammar,
    private document = doc
  ) {
    this.grammar = textMateGrammar;

    // Parse whole document
    const docRange = new vscode.Range(0, 0, this.document.lineCount, 0);
    this.reparsePretties(docRange);

    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document == this.document) this.onChangeDocument(e);
      })
    );
  }

  public dispose() {
    this.subscriptions.forEach((s) => s.dispose());
  }

  private refreshTokensOnLine(line: vscode.TextLine): {
    tokens: tm.IToken[];
    invalidated: boolean;
  } {
    if (!this.grammar) return { tokens: [], invalidated: false };
    const prevState = this.grammarState[line.lineNumber - 1] || null;
    const lineTokens = this.grammar.tokenizeLine(line.text, prevState);
    const invalidated =
      !this.grammarState[line.lineNumber] ||
      !lineTokens.ruleStack.equals(this.grammarState[line.lineNumber]);
    this.grammarState[line.lineNumber] = lineTokens.ruleStack;
    return { tokens: lineTokens.tokens, invalidated: invalidated };
  }

  public getScopeAt(position: vscode.Position): api.Token | null {
    if (!this.grammar) return null;
    position = this.document.validatePosition(position);
    const state = this.grammarState[position.line - 1] || null;
    const line = this.document.lineAt(position.line);
    const tokens = this.grammar.tokenizeLine(line.text, state);
    for (let t of tokens.tokens) {
      if (t.startIndex <= position.character && position.character < t.endIndex)
        return {
          range: new vscode.Range(position.line, t.startIndex, position.line, t.endIndex),
          text: line.text.substring(t.startIndex, t.endIndex),
          scopes: t.scopes,
        };
    }
    // FIXME: No token matched, return last token in the line.
    let lastToken = tokens.tokens[tokens.tokens.length - 1];
    return {
      range: new vscode.Range(
        position.line,
        lastToken.startIndex,
        position.line,
        lastToken.endIndex
      ),
      text: line.text.substring(lastToken.startIndex, lastToken.endIndex),
      scopes: lastToken.scopes,
    };
  }

  private reparsePretties(range: vscode.Range): void {
    range = this.document.validateRange(range);

    let invalidatedTokenState = false;

    // Collect new pretties
    const lineCount = this.document.lineCount;
    let lineIdx: number;
    for (
      lineIdx = range.start.line;
      lineIdx <= range.end.line || (invalidatedTokenState && lineIdx < lineCount);
      ++lineIdx
    ) {
      const line = this.document.lineAt(lineIdx);
      const { invalidated: invalidated } = this.refreshTokensOnLine(line);
      invalidatedTokenState = invalidated;
    }
  }

  private applyChanges(changes: readonly vscode.TextDocumentContentChangeEvent[]) {
    const sortedChanges = [...changes].sort((change1, change2) =>
      change1.range.start.isAfter(change2.range.start) ? -1 : 1
    );
    for (const change of sortedChanges) {
      try {
        const delta = textUtil.toRangeDelta(change.range, change.text);
        const editRange = textUtil.rangeDeltaNewRange(delta);

        this.reparsePretties(editRange);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private onChangeDocument(event: vscode.TextDocumentChangeEvent) {
    this.applyChanges(event.contentChanges);
  }

  public refresh() {
    this.grammarState = [];
    const docRange = new vscode.Range(0, 0, this.document.lineCount, 0);
    this.reparsePretties(docRange);
  }
}
