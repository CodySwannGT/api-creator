import type { Endpoint } from "../types/endpoint.js";
import { camelToKebab, kebabToCamel } from "../utils/naming.js";

/** Represents a single GraphQL variable field extracted from observed query param values. */
interface VarField {
  camelName: string;
  kebabName: string;
  exampleValue: string;
}

/**
 * Parses the variable fields from the observed values of the `variables` query param.
 * @param variablesQp - the `variables` query param object, if present
 * @returns an array of VarField objects representing each variable key found
 */
function parseVariableFields(
  variablesQp: { observedValues: string[] } | undefined
): VarField[] {
  if (!variablesQp || variablesQp.observedValues.length === 0) return [];
  try {
    const parsed = JSON.parse(variablesQp.observedValues[0]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, val]) => ({
        camelName: key,
        kebabName: camelToKebab(key),
        exampleValue: typeof val === "string" ? val : JSON.stringify(val),
      }));
    }
  } catch {
    // variables is not valid JSON, skip field extraction
  }
  return [];
}

/**
 * Emits a GraphQL persisted query endpoint as a Commander subcommand,
 * including variable options and baked-in operation parameters.
 * @param endpoint - the API endpoint
 * @param pathParams - extracted path parameters
 * @param methodName - the client method name
 * @param commandName - the CLI command name
 * @param hasBody - whether the endpoint has a request body
 * @returns the generated lines of code for this GraphQL command
 */
export function emitGraphQLEndpoint(
  endpoint: Endpoint,
  pathParams: { name: string; index: number }[],
  methodName: string,
  commandName: string,
  hasBody: boolean
): string[] {
  const qpMap = new Map(endpoint.queryParams.map(qp => [qp.name, qp]));
  const operationNameQp = qpMap.get("operationName")!;
  const extensionsQp = qpMap.get("extensions")!;
  const bakedOperationName = operationNameQp.observedValues[0] ?? commandName;
  const bakedExtensions = extensionsQp.observedValues[0] ?? "{}";
  const varFields = parseVariableFields(qpMap.get("variables"));

  const graphqlSpecialParams = new Set([
    "operationName",
    "extensions",
    "variables",
  ]);
  const otherParams = endpoint.queryParams.filter(
    qp => !graphqlSpecialParams.has(qp.name)
  );

  return [
    ...emitGraphQLCommandSetup(
      commandName,
      endpoint,
      pathParams,
      varFields,
      otherParams
    ),
    ...emitGraphQLActionHandler(
      pathParams,
      varFields,
      otherParams,
      bakedOperationName,
      bakedExtensions,
      methodName,
      hasBody
    ),
  ];
}

/**
 * Emits the Commander command setup lines (command name, description, arguments, options).
 * @param commandName - the CLI command name
 * @param endpoint - the API endpoint
 * @param pathParams - extracted path parameters
 * @param varFields - parsed GraphQL variable fields
 * @param otherParams - non-GraphQL query params
 * @returns lines of code for the command setup block
 */
function emitGraphQLCommandSetup(
  commandName: string,
  endpoint: Endpoint,
  pathParams: { name: string; index: number }[],
  varFields: VarField[],
  otherParams: { name: string; observedValues: string[]; required: boolean }[]
): string[] {
  const description = `${endpoint.method} ${endpoint.normalizedPath}`;
  const defaultableParams = new Map<string, string>([
    ["locale", "en"],
    ["currency", "USD"],
  ]);

  return [
    "",
    `  program`,
    `    .command('${commandName}')`,
    `    .description('${description}')`,
    ...pathParams.map(
      pp => `    .argument('<${pp.name}>', '${pp.name} path parameter')`
    ),
    ...varFields.map(vf => {
      const truncExample =
        vf.exampleValue.length > 50
          ? `${vf.exampleValue.substring(0, 47)}...`
          : vf.exampleValue;
      const safeExample = truncExample.replace(/'/g, "\\'");
      return `    .option('--${vf.kebabName} <value>', '${vf.camelName} variable (e.g. "${safeExample}")')`;
    }),
    "    .option('--variables <json>', 'Raw variables JSON (overrides individual variable options)')",
    ...otherParams.map(qp => {
      const defaultVal = defaultableParams.get(qp.name);
      return defaultVal
        ? `    .option('--${qp.name} <value>', '${qp.name} query parameter', '${defaultVal}')`
        : `    .option('--${qp.name} <value>', '${qp.name} query parameter')`;
    }),
    "    .option('--raw', 'Output compact JSON instead of pretty-printed')",
  ];
}

/**
 * Emits the `.action(async (...) => { ... })` handler lines for a GraphQL command.
 * @param pathParams - extracted path parameters
 * @param varFields - parsed GraphQL variable fields
 * @param otherParams - non-GraphQL query params
 * @param bakedOperationName - the baked-in operation name value
 * @param bakedExtensions - the baked-in extensions JSON value
 * @param methodName - the client method name to call
 * @param hasBody - whether the endpoint has a request body
 * @returns lines of code for the action handler block
 */
function emitGraphQLActionHandler(
  pathParams: { name: string; index: number }[],
  varFields: VarField[],
  otherParams: { name: string; observedValues: string[]; required: boolean }[],
  bakedOperationName: string,
  bakedExtensions: string,
  methodName: string,
  hasBody: boolean
): string[] {
  const argNames = pathParams.map(pp => pp.name);
  const actionParams =
    argNames.length > 0 ? `${argNames.join(", ")}, options` : "options";

  const bodyLines = hasBody
    ? [
        "        const bodyData = options.body || options.json || '';",
        "        let parsedBody: any;",
        "        try {",
        "          parsedBody = JSON.parse(bodyData);",
        "        } catch {",
        "          console.error('Invalid JSON body. Provide valid JSON via --body or --json.');",
        "          process.exit(1);",
        "        }",
      ]
    : [];
  const callArgs = [
    ...argNames,
    ...(hasBody ? ["parsedBody"] : []),
    "queryOpts",
  ];

  return [
    `    .action(async (${actionParams}) => {`,
    "      try {",
    "        const client = getClient();",
    "        let variables: Record<string, any>;",
    "        if (options.variables) {",
    "          try {",
    "            variables = JSON.parse(options.variables);",
    "          } catch {",
    "            console.error('Invalid JSON for --variables.');",
    "            process.exit(1);",
    "          }",
    "        } else {",
    "          variables = {};",
    ...varFields.map(vf => {
      const optionAccessor = kebabToCamel(vf.kebabName);
      return `          if (options[${JSON.stringify(optionAccessor)}] !== undefined) variables[${JSON.stringify(vf.camelName)}] = options[${JSON.stringify(optionAccessor)}];`;
    }),
    "        }",
    "        const queryOpts: any = {};",
    `        queryOpts.operationName = ${JSON.stringify(bakedOperationName)};`,
    `        queryOpts.extensions = ${JSON.stringify(bakedExtensions)};`,
    "        queryOpts.variables = JSON.stringify(variables);",
    ...otherParams.map(
      qp =>
        `        if (options.${qp.name} !== undefined) queryOpts.${qp.name} = options.${qp.name};`
    ),
    ...bodyLines,
    `        const result = await client.${methodName}(${callArgs.join(", ")});`,
    "        const output = options.raw ? JSON.stringify(result) : JSON.stringify(result, null, 2);",
    "        console.log(output);",
    "      } catch (error) {",
    "        handleError(error);",
    "      }",
    "    });",
  ];
}
