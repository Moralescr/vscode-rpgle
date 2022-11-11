import { Definition, ImplementationParams, Location, Range } from 'vscode-languageserver';
import { documents, parser, getWordRangeAtPosition } from '.';
import { BindingDirectory, symbolLookup, validateUri } from '../connection';

import * as Project from './project';

export default async function implementationProvider(params: ImplementationParams): Promise<Definition | undefined> {
	const currentPath = params.textDocument.uri;
	const document = documents.get(currentPath);

	if (document) {
		const word = getWordRangeAtPosition(document, params.position);
		if (word) {
			const upperName = word.toUpperCase();

			if (Project.isEnabled) {
				// If project mode is enabled, then we start by looking through the local cache
				const parsedFiles = Object.keys(parser.parsedCache);

				for (const uri of parsedFiles) {
					const cache = parser.getParsedCache(uri);
					for (const proc of cache.procedures) {
						const keyword = proc.keyword[`EXPORT`];
						if (keyword) {
							if (proc.name.toUpperCase() === upperName) {
								return Location.create(
									proc.position.path,
									Range.create(
										proc.position.line,
										0,
										proc.position.line,
										0
									)
								);
							}
						}
					}
				};
			}

			// Then, we fall back to the server to see if we can find a reference or something?
			const cache = parser.getParsedCache(currentPath);
			if (cache) {
				const bnddir: string|undefined = cache.keyword[`BNDDIR`];
				if (bnddir) {
					const objectStrings = bnddir.split(`:`).map(obj => trimQuotes(obj));
					const objects: BindingDirectory[] = objectStrings.map(qualifiedPath => {
						const parts = qualifiedPath.split(`/`);
						return {
							name: parts[parts.length - 1],
							lib: parts[parts.length - 2]
						}
					});
					
					const possibleUris = await symbolLookup(word, objects);
					if (possibleUris) {
						const validUris = await Promise.allSettled(possibleUris.map(uri => validateUri(uri)));
						// By this time, if they were valid, they are part of the cache.

						for (const possibleUri of validUris) {
							if (possibleUri.status === `fulfilled` && possibleUri.value) {
								const cache = parser.getParsedCache(possibleUri.value);
								if (cache) {
									const proc = cache.find(word);
									return Location.create(
										proc.position.path,
										Range.create(
											proc.position.line,
											0,
											proc.position.line,
											0
										)
									);
								}
							}
						}
					}
				}
			}
		}
	}

	return;
}

function trimQuotes(input: string) {
	if (input[0] === `'`) input = input.substring(1);
	if (input[input.length - 1] === `'`) input = input.substring(0, input.length - 1);
	return input;
}