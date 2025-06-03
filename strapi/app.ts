import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { inspect } from 'node:util';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log(event);
    if (!event.body) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: 'Need to provide activity',
            }),
        };
    }
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: 'POST is the only supported method',
            }),
        };
    }
    const activity = JSON.parse(event.body);
    console.log(activity);
    const secret_name = 'prenda';

    const client = new SecretsManagerClient({
        region: 'eu-west-3',
    });

    let secretsResponse;

    try {
        secretsResponse = await client.send(
            new GetSecretValueCommand({
                SecretId: secret_name,
                VersionStage: 'AWSCURRENT', // VersionStage defaults to AWSCURRENT if unspecified
            }),
        );
    } catch (error) {
        // For a list of exceptions thrown, see
        // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
        throw error;
    }

    if (!secretsResponse?.SecretString) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Need to provide secret called prenda',
            }),
        };
    }

    try {
        const secrets = JSON.parse(secretsResponse.SecretString);

        const strapiBearerToken = secrets.STRAPI_BEARER_TOKEN;

        const foci = (await getAll('foci', strapiBearerToken)).data;
        const topics = (await getAll('topics', strapiBearerToken)).data;
        const formats = (await getAll('formats', strapiBearerToken)).data;
        const learningModes = (await getAll('learning-modes', strapiBearerToken)).data;
        const subjects = (await getAll('subjects', strapiBearerToken)).data;
        const levels = (await getAll('levels', strapiBearerToken)).data;

        activity.focus = findDocumentId(activity.focus, foci);
        activity.topic = findDocumentId(activity.topic, topics);
        activity.format = findDocumentId(activity.format, formats);
        activity.learning_mode = findDocumentId(activity.learning_mode, learningModes);
        activity.subject = findDocumentId(activity.subject, subjects);
        activity.levels = activity.levels.map((level) => findDocumentId(level, levels));
        activity.step1 = fixRichText(activity.step1);
        activity.step2 = fixRichText(activity.step2);
        activity.step3 = fixRichText(activity.step3);
        activity.step4 = fixRichText(activity.step4);

        await save(activity, strapiBearerToken);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'success',
            }),
        };
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: inspect(err),
            }),
        };
    }
};

function findDocumentId(value: string, relations: { name: string; documentId: string }[]) {
    const relation = relations.find((relation) => relation.name === value);
    if (!relation) {
        throw new Error(`${value} not found in ${relations.map((relation) => relation.name).join(', ')}`);
    }
    return relation.documentId;
}

async function save(activity, strapiBearerToken: string) {
    const payload = { data: activity };
    console.log({ payload });
    const strapiResponse = await fetch(`https://learn-content-api.fly.dev/api/activity-cards?status=draft`, {
        headers: {
            authorization: `Bearer ${strapiBearerToken}`,
            'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify(payload),
    });
    console.log(strapiResponse.status);
    console.dir(await strapiResponse.json(), { depth: 10 });
    console.log(strapiResponse);
}

async function getAll(resource: string, strapiBearerToken: string) {
    const strapiResponse = await fetch(`https://learn-content-api.fly.dev/api/${resource}?pagination[pageSize]=250`, {
        headers: {
            authorization: `Bearer ${strapiBearerToken}`,
        },
    });
    console.log(`about to get json for ${resource}`, strapiResponse.status);
    return strapiResponse.json();
}

function fixRichText(text: string) {
    return text.split(/\n+/).map((line) => ({
        type: 'paragraph',
        children: [
            {
                text: line,
                type: 'text',
            },
        ],
    }));
}
