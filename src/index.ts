/**
 * @author superchow
 * @emil superchow@live.cn
 */

import { Base64 } from 'js-base64';

import { convert, decode, encode } from './charset';
import { GB2312UTF8, getCharsetName, guid, mimeDecode, wrap, getBoundary } from './utils';
import type {
	KeyValue,
	EmailAddress,
	ParsedEmlJson,
	ReadedEmlJson,
	Attachment,
	EmlHeaders,
	Options,
	BuildOptions,
	CallbackFn,
	OptionOrNull,
	BoundaryRawData,
	BoundaryConvertedData,
	BoundaryHeaders,
} from './interface';
import { addressparser } from './addressparser';

/**
 * log for test
 */
let verbose: boolean = false;
const defaultCharset = 'utf-8';
const fileExtensions: KeyValue = {
	'text/plain': '.txt',
	'text/html': '.html',
	'image/png': '.png',
	'image/jpg': '.jpg',
	'image/jpeg': '.jpg',
};

/**
 * Gets file extension by mime type
 * @param {String} mimeType
 * @returns {String}
 */

function getFileExtension(mimeType: string): string {
	return fileExtensions[mimeType] || '';
}

/**
 * create a boundary
 */
function createBoundary(): string {
	return '----=' + guid();
}
/**
 * Builds e-mail address string, e.g. { name: 'PayPal', email: 'noreply@paypal.com' } => 'PayPal' <noreply@paypal.com>
 * @param {String|EmailAddress|EmailAddress[]|null} data
 */
function toEmailAddress(data?: string | EmailAddress | EmailAddress[] | null): string {
	let email = '';
	if (typeof data === 'undefined') {
		//No e-mail address
	} else if (typeof data === 'string') {
		email = data;
	} else if (typeof data === 'object') {
		if (Array.isArray(data)) {
			email += data
				.map((item) => {
					let str = '';
					if (item.name) {
						str += '"' + item.name.replace(/^"|"\s*$/g, '') + '" ';
					}
					if (item.email) {
						str += '<' + item.email + '>';
					}
					return str;
				})
				.filter((a) => a)
				.join(', ');
		} else {
			if (data) {
				if (data.name) {
					email += '"' + data.name.replace(/^"|"\s*$/g, '') + '" ';
				}
				if (data.email) {
					email += '<' + data.email + '>';
				}
			}
		}
	}
	return email;
}

/**
 * Gets character set name, e.g. contentType='.....charset='iso-8859-2'....'
 * @param {String} contentType
 * @returns {String|undefined}
 */
function getCharset(contentType: string) {
	const match = /charset\s*=\W*([\w\-]+)/g.exec(contentType);
	return match ? match[1] : undefined;
}

/**
 * Gets name and e-mail address from a string, e.g. 'PayPal' <noreply@paypal.com> => { name: 'PayPal', email: 'noreply@paypal.com' }
 * @param {String} raw
 * @returns { EmailAddress | EmailAddress[] | null}
 */
function getEmailAddress(rawStr: string): EmailAddress | EmailAddress[] | null {
	const raw = unquoteString(rawStr);
	const parseList = addressparser(raw);
	const list = parseList.map((v) => ({ name: v.name, email: v.address }) as EmailAddress);

	//Return result
	if (list.length === 0) {
		return null; //No e-mail address
	}
	if (list.length === 1) {
		return list[0]; //Only one record, return as object, required to preserve backward compatibility
	}
	return list; //Multiple e-mail addresses as array
}

/**
 * decode one joint
 * @param {String} str
 * @returns {String}
 */
function decodeJoint(str: string) {
	const match = /=\?([^?]+)\?(B|Q)\?(.+?)(\?=)/gi.exec(str);
	if (match) {
		const charset = getCharsetName(match[1] || defaultCharset); //eq. match[1] = 'iso-8859-2'; charset = 'iso88592'
		const type = match[2].toUpperCase();
		const value = match[3];
		if (type === 'B') {
			//Base64
			if (charset === 'utf8') {
				return decode(encode(Base64.fromBase64(value.replace(/\r?\n/g, ''))), 'utf8');
			} else {
				return decode(Base64.toUint8Array(value.replace(/\r?\n/g, '')), charset);
			}
		} else if (type === 'Q') {
			//Quoted printable
			return unquotePrintable(value, charset, true);
		}
	}
	return str;
}

/**
 * decode section
 * @param {String} str
 * @returns {String}
 */
function unquoteString(str: string): string {
	const regex = /=\?([^?]+)\?(B|Q)\?(.+?)(\?=)/gi;
	let decodedString = str || '';
	const spinOffMatch = decodedString.match(regex);
	if (spinOffMatch) {
		spinOffMatch.forEach((spin) => {
			decodedString = decodedString.replace(spin, decodeJoint(spin));
		});
	}

	return decodedString.replace(/\r?\n/g, '');
}
/**
 * Decodes 'quoted-printable'
 * @param {String} value
 * @param {String} charset
 * @param {String} qEncoding whether the encoding is RFC-2047’s Q-encoding, meaning special handling of underscores.
 * @returns {String}
 */
function unquotePrintable(value: string, charset?: string, qEncoding = false): string {
	//Convert =0D to '\r', =20 to ' ', etc.
	// if (!charset || charset == "utf8" || charset == "utf-8") {
	//   return value
	//     .replace(/=([\w\d]{2})=([\w\d]{2})=([\w\d]{2})/gi, function (matcher, p1, p2, p3, offset, string) {

	//     })
	//     .replace(/=([\w\d]{2})=([\w\d]{2})/gi, function (matcher, p1, p2, offset, string) {

	//     })
	//     .replace(/=([\w\d]{2})/gi, function (matcher, p1, offset, string) { return String.fromCharCode(parseInt(p1, 16)); })
	//     .replace(/=\r?\n/gi, ""); //Join line
	// } else {
	//   return value
	//     .replace(/=([\w\d]{2})=([\w\d]{2})/gi, function (matcher, p1, p2, offset, string) {

	//     })
	//     .replace(/=([\w\d]{2})/gi, function (matcher, p1, offset, string) {

	//      })
	//     .replace(/=\r?\n/gi, ''); //Join line
	// }
	let rawString = value
		.replace(/[\t ]+$/gm, '') // remove invalid whitespace from the end of lines
		.replace(/=(?:\r?\n|$)/g, ''); // remove soft line breaks

	if (qEncoding) {
		rawString = rawString.replace(/_/g, decode(new Uint8Array([0x20]), charset));
	}

	return mimeDecode(rawString, charset);
}

/**
 * Parses EML file content and returns object-oriented representation of the content.
 * @param {String} eml
 * @param {OptionOrNull | CallbackFn<ParsedEmlJson>} options
 * @param {CallbackFn<ParsedEmlJson>} callback
 * @returns {string | Error | ParsedEmlJson}
 */
function parse(
	eml: string,
	options?: OptionOrNull | CallbackFn<ParsedEmlJson>,
	callback?: CallbackFn<ParsedEmlJson>
): string | Error | ParsedEmlJson {
	//Shift arguments
	if (typeof options === 'function' && typeof callback === 'undefined') {
		callback = options;
		options = null;
	}
	if (typeof options !== 'object') {
		options = { headersOnly: false };
	}
	let error: string | Error | undefined;
	let result: ParsedEmlJson | undefined = {} as ParsedEmlJson;
	try {
		if (typeof eml !== 'string') {
			throw new Error('Argument "eml" expected to be string!');
		}

		const lines = eml.split(/\r?\n/);
		result = parseRecursive(lines, 0, result, options as Options) as ParsedEmlJson;
	} catch (e) {
		error = e as string;
	}
	callback && callback(error, result);
	return error || result || new Error('read EML failed!');
}

/**
 * Parses EML file content.
 * @param {String[]} lines
 * @param {Number}   start
 * @param {Options}  options
 * @returns {ParsedEmlJson}
 */
function parseRecursive(lines: string[], start: number, parent: any, options: Options) {
	let boundary: any = null;
	let lastHeaderName = '';
	let findBoundary = '';
	let insideBody = false;
	let insideBoundary = false;
	let isMultiHeader = false;
	let isMultipart = false;
	let checkedForCt = false;
	let ctInBody = false;

	parent.headers = {};
	//parent.body = null;

	function complete(boundary: any) {
		//boundary.part = boundary.lines.join("\r\n");
		boundary.part = {};
		parseRecursive(boundary.lines, 0, boundary.part, options);
		delete boundary.lines;
	}

	//Read line by line
	for (let i = start; i < lines.length; i++) {
		let line = lines[i];

		//Header
		if (!insideBody) {
			//Search for empty line
			if (line == '') {
				insideBody = true;

				if (options && options.headersOnly) {
					break;
				}

				//Expected boundary
				let ct = parent.headers['Content-Type'] || parent.headers['Content-type'];
				if (!ct) {
					if (checkedForCt) {
						insideBody = !ctInBody;
					} else {
						checkedForCt = true;
						const lineClone = Array.from(lines);
						const string = lineClone.splice(i).join('\r\n');
						const trimmedStrin = string.trim();
						if (trimmedStrin.indexOf('Content-Type') === 0 || trimmedStrin.indexOf('Content-type') === 0) {
							insideBody = false;
							ctInBody = true;
						} else {
							console.warn('Warning: undefined Content-Type');
						}
					}
				} else if (/^multipart\//g.test(ct)) {
					let b = getBoundary(ct);
					if (b && b.length) {
						findBoundary = b;
						isMultipart = true;
						parent.body = [];
					} else {
						if (verbose) {
							console.warn('Multipart without boundary! ' + ct.replace(/\r?\n/g, ' '));
						}
					}
				}

				continue;
			}

			//Header value with new line
			let match = /^\s+([^\r\n]+)/g.exec(line);
			if (match) {
				if (isMultiHeader) {
					parent.headers[lastHeaderName][parent.headers[lastHeaderName].length - 1] += '\r\n' + match[1];
				} else {
					parent.headers[lastHeaderName] += '\r\n' + match[1];
				}
				continue;
			}

			//Header name and value
			match = /^([\w\d\-]+):\s*([^\r\n]*)/gi.exec(line);
			if (match) {
				lastHeaderName = match[1];
				if (parent.headers[lastHeaderName]) {
					//Multiple headers with the same name
					isMultiHeader = true;
					if (typeof parent.headers[lastHeaderName] == 'string') {
						parent.headers[lastHeaderName] = [parent.headers[lastHeaderName]];
					}
					parent.headers[lastHeaderName].push(match[2]);
				} else {
					//Header first appeared here
					isMultiHeader = false;
					parent.headers[lastHeaderName] = match[2];
				}
				continue;
			}
		}
		//Body
		else {
			//Multipart body
			if (isMultipart) {
				//Search for boundary start

				//Updated on 2019-10-12: A line before the boundary marker is not required to be an empty line
				//if (lines[i - 1] == "" && line.indexOf("--" + findBoundary) == 0 && !/\-\-(\r?\n)?$/g.test(line)) {
				if (line.indexOf('--' + findBoundary) == 0 && line.indexOf('--' + findBoundary + '--') !== 0) {
					insideBoundary = true;

					//Complete the previous boundary
					if (boundary && boundary.lines) {
						complete(boundary);
					}

					//Start a new boundary
					let match = /^\-\-([^\r\n]+)(\r?\n)?$/g.exec(line) as RegExpExecArray;
					boundary = { boundary: match[1], lines: [] as any[] };
					parent.body.push(boundary);

					if (verbose) {
						console.log('Found boundary: ' + boundary.boundary);
					}

					continue;
				}

				if (insideBoundary) {
					//Search for boundary end
					if (boundary?.boundary && lines[i - 1] == '' && line.indexOf('--' + findBoundary + '--') == 0) {
						insideBoundary = false;
						complete(boundary);
						continue;
					}
					if (boundary?.boundary && line.indexOf('--' + findBoundary + '--') == 0) {
						continue;
					}
					boundary?.lines.push(line);
				}
			} else {
				//Solid string body
				parent.body = lines.splice(i).join('\r\n');
				break;
			}
		}
	}

	//Complete the last boundary
	if (parent.body && parent.body.length && parent.body[parent.body.length - 1].lines) {
		complete(parent.body[parent.body.length - 1]);
	}

	return parent;
}

/**
 * Convert BoundaryRawData to BoundaryConvertedData
 * @param {BoundaryRawData} boundary
 * @returns {BoundaryConvertedData} Obj
 */
function completeBoundary(boundary: BoundaryRawData): BoundaryConvertedData | null {
	if (!boundary || !boundary.boundary) {
		return null;
	}
	const lines = boundary.lines || [];
	const result = {
		boundary: boundary.boundary,
		part: {
			headers: {},
		},
	} as BoundaryConvertedData;
	let lastHeaderName = '';
	let insideBody = false;
	let childBoundary: BoundaryRawData | undefined;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!insideBody) {
			if (line === '') {
				insideBody = true;
				continue;
			}
			const match = /^([\w\d\-]+):\s*([^\r\n]*)/gi.exec(line);
			if (match) {
				lastHeaderName = match[1];
				result.part.headers[lastHeaderName] = match[2];
				continue;
			}
			//Header value with new line
			const lineMatch = /^\s+([^\r\n]+)/g.exec(line);
			if (lineMatch) {
				result.part.headers[lastHeaderName] += '\r\n' + lineMatch[1];
				continue;
			}
		} else {
			// part.body
			const match = /^\-\-([^\r\n]+)(\r?\n)?$/g.exec(line);
			const childBoundaryStr = getBoundary(result.part.headers['Content-Type'] || result.part.headers['Content-type']);
			if (verbose) {
				if (match) {
					console.log(`line 568: line is ${line}, ${'--' + childBoundaryStr}`, `${line.indexOf('--' + childBoundaryStr)}`);
				}
			}
			if (match && line.indexOf('--' + childBoundaryStr) === 0 && !childBoundary) {
				childBoundary = { boundary: match ? match[1] : '', lines: [] };
				continue;
			} else if (!!childBoundary && childBoundary.boundary) {
				if (lines[index - 1] === '' && line.indexOf('--' + childBoundary.boundary) === 0) {
					const child = completeBoundary(childBoundary);
					if (verbose) {
						console.info(`578: ${JSON.stringify(child)}`);
					}
					if (child) {
						if (Array.isArray(result.part.body)) {
							result.part.body.push(child);
						} else {
							result.part.body = [child];
						}
					} else {
						result.part.body = childBoundary.lines.join('\r\n');
					}
					// next line child
					if (!!lines[index + 1]) {
						childBoundary.lines = [];
						continue;
					}
					// end line child And this boundary's end
					if (line.indexOf('--' + childBoundary.boundary + '--') === 0 && lines[index + 1] === '') {
						if (verbose) {
							console.info('line 601 childBoundary is over line is 534');
						}
						childBoundary = undefined;
						break;
					}
				}
				childBoundary.lines.push(line);
			} else {
				if (verbose) {
					console.warn('body is string');
				}
				result.part.body = lines.splice(index).join('\r\n');
				break;
			}
		}
	}
	return result;
}

/**
 * Parses EML file content and return user-friendly object.
 * @param {String | ParsedEmlJson} eml EML file content or object from 'parse'
 * @param { OptionOrNull | CallbackFn<ReadedEmlJson>} options EML parse options
 * @param {CallbackFn<ReadedEmlJson>} callback Callback function(error, data)
 */
function read(
	eml: string | ParsedEmlJson,
	options?: OptionOrNull | CallbackFn<ReadedEmlJson>,
	callback?: CallbackFn<ReadedEmlJson>
): ReadedEmlJson | Error | string {
	//Shift arguments
	if (typeof options === 'function' && typeof callback === 'undefined') {
		callback = options;
		options = null;
	}
	let error: Error | string | undefined;
	let result: ReadedEmlJson | undefined;

	//Appends the boundary to the result
	function _append(headers: EmlHeaders, content: string | Uint8Array | Attachment, result: ReadedEmlJson) {
		const contentType = headers['Content-Type'] || headers['Content-type'];
		const contentDisposition = headers['Content-Disposition'];

		const charset = getCharsetName(getCharset(contentType as string) || defaultCharset);
		let encoding = headers['Content-Transfer-Encoding'] || headers['Content-transfer-encoding'];
		if (typeof encoding === 'string') {
			encoding = encoding.toLowerCase();
		}
		if (encoding === 'base64') {
			if (contentType && contentType.indexOf('gbk') >= 0) {
				// is work?  I'm not sure
				content = encode(GB2312UTF8.GB2312ToUTF8((content as string).replace(/\r?\n/g, '')));
			} else {
				// string to Uint8Array by TextEncoder
				content = encode((content as string).replace(/\r?\n/g, ''));
			}
		} else if (encoding === 'quoted-printable') {
			content = unquotePrintable(content as string, charset);
		} else if (encoding && charset !== 'utf8' && encoding.search(/binary|8bit/) === 0) {
			//'8bit', 'binary', '8bitmime', 'binarymime'
			content = decode(content as Uint8Array, charset);
		}

		if (!contentDisposition && contentType && contentType.indexOf('text/html') >= 0) {
			if (typeof content !== 'string') {
				content = decode(content as Uint8Array, charset);
			}

			let htmlContent = content.replace(/\r\n|(&quot;)/g, '').replace(/\"/g, `"`);

			try {
				if (encoding === 'base64') {
					htmlContent = Base64.decode(htmlContent);
				} else if (Base64.btoa(Base64.atob(htmlContent)) == htmlContent) {
					htmlContent = Base64.atob(htmlContent);
				}
			} catch (error) {
				console.error(error);
			}

			if (result.html) {
				result.html += htmlContent;
			} else {
				result.html = htmlContent;
			}

			result.htmlheaders = {
				'Content-Type': contentType,
				'Content-Transfer-Encoding': encoding || '',
			};
			// self boundary Not used at conversion
		} else if (!contentDisposition && contentType && contentType.indexOf('text/plain') >= 0) {
			if (typeof content !== 'string') {
				content = decode(content as Uint8Array, charset);
			}
			if (encoding === 'base64') {
				content = Base64.decode(content);
			}
			//Plain text message

			if (result.text) {
				result.text += content;
			} else {
				result.text = content;
			}

			result.textheaders = {
				'Content-Type': contentType,
				'Content-Transfer-Encoding': encoding || '',
			};
			// self boundary Not used at conversion
		} else {
			//Get the attachment
			if (!result.attachments) {
				result.attachments = [];
			}

			const attachment = {} as Attachment;

			const contentIdWithBrackets = headers['Content-ID'] || headers['Content-Id'];
			const contentId = contentIdWithBrackets?.replace(/^<|>$/g, '');
			if (contentId) {
				attachment.contentId = contentId;
			}

			const NameContainer = ['Content-Disposition', 'Content-Type', 'Content-type'];

			let result_name;
			for (const key of NameContainer) {
				const name: string = headers[key];
				if (name) {
					result_name = name
						.replace(/(\s|'|utf-8|\*[0-9]\*)/g, '')
						.split(';')
						.map((v) => /name[\*]?="?(.+?)"?$/gi.exec(v))
						.reduce((a, b) => {
							if (b && b[1]) {
								a += b[1];
							}
							return a;
						}, '');
					if (result_name) {
						break;
					}
				}
			}
			if (result_name) {
				attachment.name = decodeURI(result_name);
			}

			const ct = headers['Content-Type'] || headers['Content-type'];
			if (ct) {
				attachment.contentType = ct;
			}

			const cd = headers['Content-Disposition'];
			if (cd) {
				attachment.inline = /^\s*inline/g.test(cd);
				const sizeRegexMatches = /size\s*=\s*([0-9]+)/gi.exec(cd);
				attachment.size = parseInt(sizeRegexMatches?.[1] ?? '0');
			}

			result.attachments.push(attachment);
		}
	}

	function _read(data: ParsedEmlJson): ReadedEmlJson | Error | string {
		if (!data) {
			return 'no data';
		}
		try {
			const result = {} as ReadedEmlJson;
			if (!data.headers) {
				throw new Error("data does't has headers");
			}
			if (data.headers['Date']) {
				result.date = new Date(data.headers['Date']);
			}
			if (data.headers['Subject']) {
				result.subject = unquoteString(data.headers['Subject']);
			}
			if (data.headers['From']) {
				result.from = getEmailAddress(data.headers['From']);
			}
			if (data.headers['To']) {
				result.to = getEmailAddress(data.headers['To']);
			}
			if (data.headers['CC']) {
				result.cc = getEmailAddress(data.headers['CC']);
			}
			if (data.headers['Cc']) {
				result.cc = getEmailAddress(data.headers['Cc']);
			}
			result.headers = data.headers;

			//Content mime type
			let boundary: any = null;
			const ct = data.headers['Content-Type'] || data.headers['Content-type'];
			if (ct && /^multipart\//g.test(ct)) {
				const b = getBoundary(ct);
				if (b && b.length) {
					boundary = b;
				}
			}

			if (boundary && Array.isArray(data.body)) {
				for (let i = 0; i < data.body.length; i++) {
					const boundaryBlock = data.body[i];
					if (!boundaryBlock) {
						continue;
					}
					//Get the message content
					if (typeof boundaryBlock.part === 'undefined') {
						verbose && console.warn('Warning: undefined b.part');
					} else if (typeof boundaryBlock.part === 'string') {
						result.data = boundaryBlock.part;
					} else {
						if (typeof boundaryBlock.part.body === 'undefined') {
							verbose && console.warn('Warning: undefined b.part.body');
						} else if (typeof boundaryBlock.part.body === 'string') {
							_append(boundaryBlock.part.headers, boundaryBlock.part.body, result);
						} else {
							// keep multipart/alternative
							const currentHeaders = boundaryBlock.part.headers;
							const currentHeadersContentType = currentHeaders['Content-Type'] || currentHeaders['Content-type'];
							if (verbose) {
								console.log(`line 969 currentHeadersContentType: ${currentHeadersContentType}`);
							}
							// Hasmore ?
							if (currentHeadersContentType && currentHeadersContentType.indexOf('multipart') >= 0 && !result.multipartAlternative) {
								result.multipartAlternative = {
									'Content-Type': currentHeadersContentType,
								};
							}
							for (let j = 0; j < boundaryBlock.part.body.length; j++) {
								const selfBoundary = boundaryBlock.part.body[j];
								if (typeof selfBoundary === 'string') {
									result.data = selfBoundary;
									continue;
								}

								const headers = selfBoundary.part.headers;
								const content = selfBoundary.part.body;
								if (Array.isArray(content)) {
									(content as any).forEach((bound: any) => {
										_append(bound.part.headers, bound.part.body, result);
									});
								} else {
									_append(headers, content, result);
								}
							}
						}
					}
				}
			} else if (typeof data.body === 'string') {
				_append(data.headers, data.body, result);
			}
			return result;
		} catch (e) {
			return e as any;
		}
	}

	if (typeof eml === 'string') {
		const parseResult = parse(eml, options as OptionOrNull);
		if (typeof parseResult === 'string' || parseResult instanceof Error) {
			error = parseResult;
		} else {
			const readResult = _read(parseResult);
			if (typeof readResult === 'string' || readResult instanceof Error) {
				error = readResult;
			} else {
				result = readResult;
			}
		}
	} else if (typeof eml === 'object') {
		const readResult = _read(eml);
		if (typeof readResult === 'string' || readResult instanceof Error) {
			error = readResult;
		} else {
			result = readResult;
		}
	} else {
		error = new Error('Missing EML file content!');
	}
	callback && callback(error, result);
	return error || result || new Error('read EML failed!');
}

/**
 * if you need
 * eml-format all api
 */
export {
	getEmailAddress,
	toEmailAddress,
	createBoundary,
	getBoundary,
	getCharset,
	unquoteString,
	unquotePrintable,
	mimeDecode,
	Base64,
	convert,
	encode,
	decode,
	completeBoundary,
	ParsedEmlJson,
	ReadedEmlJson,
	EmailAddress,
	Attachment,
	BoundaryHeaders,
	parse as parseEml,
	read as readEml,
	GB2312UTF8 as GBKUTF8,
};

//  const GBKUTF8 = GB2312UTF8;

//  const parseEml = parse;
//  const readEml = read;
//  const buildEml = build;
