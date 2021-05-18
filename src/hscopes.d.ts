import * as vscode from 'vscode';
import * as tm from 'vscode-textmate';

/**
 * A grammar
 */
export { IGrammar, ITokenizeLineResult, IToken } from 'vscode-textmate';

export interface Token {
  range: vscode.Range;
  text: string;
  scopes: string[];
}

export interface HScopesAPI {
  getScopeAt(document: vscode.TextDocument, position: vscode.Position): Token | null;
  getGrammar(scopeName: string): Promise<tm.IGrammar | null>;
  getScopeForLanguage(language: string): string | null;
}
