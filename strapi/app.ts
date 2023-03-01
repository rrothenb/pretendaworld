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

        activity.focus = foci.find((focus) => activity.focus === focus.name).documentId;
        activity.topic = topics.find((topic) => activity.topic === topic.name).documentId;
        activity.format = formats.find((format) => activity.format === format.name).documentId;
        activity.learning_mode = learningModes.find(
            (learningMode) => activity.learning_mode === learningMode.name,
        ).documentId;
        activity.subject = subjects.find((subject) => activity.subject === subject.name).documentId;
        activity.levels = activity.levels.map((level) => levels.find((entry) => level == entry.name).documentId);
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
    const strapiResponse = await fetch(`https://learn-content-api.fly.dev/api/${resource}?pagination[pageSize]=100`, {
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
