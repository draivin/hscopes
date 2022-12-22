// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as tm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';
import * as path from 'path';
import * as fs from 'fs';
import { DocumentController } from './document';
import * as api from './hscopes';

const wasmBin = fs.readFileSync(
  path.join(__dirname, '../../node_modules/vscode-oniguruma/release/onig.wasm')
).buffer;
const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
  return {
    createOnigScanner: (sources: any) => oniguruma.createOnigScanner(sources),
    createOnigString: (s: any) => oniguruma.createOnigString(s),
  };
});

/** Tracks all documents that substitutions are being applied to */
let documents = new Map<vscode.Uri, DocumentController>();

export let registry: tm.Registry;

interface ExtensionGrammar {
  language?: string;
  scopeName?: string;
  path?: string;
  embeddedLanguages?: { [scopeName: string]: string };
  injectTo?: string[];
}
interface ExtensionPackage {
  contributes?: {
    languages?: { id: string; configuration: string }[];
    grammars?: ExtensionGrammar[];
  };
}

function getLanguageScopeName(languageId: string): string {
  try {
    const languages = vscode.extensions.all
      .filter(
        (x) => x.packageJSON && x.packageJSON.contributes && x.packageJSON.contributes.grammars
      )
      .reduce(
        (a: ExtensionGrammar[], b) => [
          ...a,
          ...(b.packageJSON as ExtensionPackage).contributes.grammars,
        ],
        []
      );
    const matchingLanguages = languages.filter((g) => g.language === languageId);

    if (matchingLanguages.length > 0) {
      // console.info(`Mapping language ${languageId} to initial scope ${matchingLanguages[0].scopeName}`);
      return matchingLanguages[0].scopeName;
    }
  } catch (err) {}
  return undefined;
}

export let workspaceState: vscode.Memento;

/** initialize everything; main entry point */
export function activate(context: vscode.ExtensionContext): api.HScopesAPI {
  workspaceState = context.workspaceState;

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(openDocument));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(closeDocument));

  reloadGrammar();

  const api: api.HScopesAPI = {
    reloadScope(document: vscode.TextDocument): boolean {
      const prettyDoc = documents.get(document.uri);
      if (prettyDoc) {
        prettyDoc.refresh();
        return true;
      }
      return false;
    },
    getScopeAt(document: vscode.TextDocument, position: vscode.Position): api.Token | null {
      try {
        const prettyDoc = documents.get(document.uri);
        if (prettyDoc) {
          return prettyDoc.getScopeAt(position);
        }
      } catch (err) {}
      return null;
    },
    getScopeForLanguage(language: string): string | null {
      return getLanguageScopeName(language) || null;
    },
    async getGrammar(scopeName: string): Promise<api.IGrammar | null> {
      try {
        if (registry) return await registry.loadGrammar(scopeName);
      } catch (err) {}
      return null;
    },
  };

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('hscopes.reloadCurrentDocument', (editor) => {
      api.reloadScope(editor.document);
    })
  );

  return api;
}

/** Re-read the settings and recreate substitutions for all documents */
function reloadGrammar() {
  try {
    registry = new tm.Registry({
      onigLib: vscodeOnigurumaLib,
      getInjections: (scopeName) => {
        let extensions = vscode.extensions.all.filter(
          (x) => x.packageJSON && x.packageJSON.contributes && x.packageJSON.contributes.grammars
        );

        let grammars = extensions.flatMap((e) => {
          return (e.packageJSON as ExtensionPackage).contributes!.grammars;
        });

        return grammars
          .filter((g) => g.injectTo && g.injectTo.some((s) => s === scopeName))
          .map((g) => g.scopeName);
      },

      loadGrammar: async (scopeName) => {
        try {
          let extensions = vscode.extensions.all.filter(
            (x) => x.packageJSON && x.packageJSON.contributes && x.packageJSON.contributes.grammars
          );

          let grammars = extensions.flatMap((e) => {
            return (e.packageJSON as ExtensionPackage).contributes!.grammars.map((g) => {
              return { extensionPath: e.extensionPath, ...g };
            });
          });

          const matchingGrammars = grammars.filter((g) => g.scopeName === scopeName);

          if (matchingGrammars.length > 0) {
            const grammar = matchingGrammars[0];
            const filePath = path.join(grammar.extensionPath, grammar.path);
            let content = await fs.promises.readFile(filePath, 'utf-8');
            return await tm.parseRawGrammar(content, filePath);
          }
        } catch (err) {
          console.error(`HyperScopes: Unable to load grammar for scope ${scopeName}.`, err);
        }
        return undefined;
      },
    });
  } catch (err) {
    registry = undefined;
    console.error(err);
  }

  // Recreate the documents
  unloadDocuments();
  for (const doc of vscode.workspace.textDocuments) openDocument(doc);
}

const blacklist = [
  '\\settings',
  '\\ignoredSettings',
  '\\launch',
  '\\token-styling',
  '\\textmate-colors',
  '\\workbench-colors',
];

async function openDocument(doc: vscode.TextDocument) {
  for (let entry of blacklist) {
    if (doc.fileName.startsWith(entry)) return;
  }

  try {
    const prettyDoc = documents.get(doc.uri);
    if (prettyDoc) {
      prettyDoc.refresh();
    } else if (registry) {
      const scopeName = getLanguageScopeName(doc.languageId);
      if (scopeName) {
        const grammar = await registry.loadGrammar(scopeName);
        documents.set(doc.uri, new DocumentController(doc, grammar));
      }
    }
  } catch (err) {}
}

function closeDocument(doc: vscode.TextDocument) {
  const prettyDoc = documents.get(doc.uri);
  if (prettyDoc) {
    prettyDoc.dispose();
    documents.delete(doc.uri);
  }
}

function unloadDocuments() {
  for (const prettyDoc of documents.values()) {
    prettyDoc.dispose();
  }
  documents.clear();
}

/** clean-up; this extension is being unloaded */
export function deactivate() {
  unloadDocuments();
}
