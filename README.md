# Realtime AI App

## Run the Project

1. Clone the project.
1. Create a `gpt-4o-realtime-preview` in Azure AI Foundry.
1. If running locally, run the following to add the OpenAI Contributor role to your user principal.

```
az role assignment create \
  --role "Cognitive Services OpenAI Contributor" \
  --assignee-object-id "<USER_PRINCIPAL_ID>" \
  --scope "/subscriptions/<SUBSCRIPTION_ID>/resourceGroups/<RESOURCE_GROUP>" \
  --assignee-principal-type User
```

1. Add an `.env` file to the root of the project and add the Azure deployment name and endpoint. If running locally run the following to 

```
OPENAI_API_KEY=
OPENAI_ENDPOINT=
OPENAI_DEPLOYMENT=gpt-4o-realtime-preview
```

2. Run `npm i` in the `client` and `server` directories.
3. Run `npm run dev` in the `server` directory.
4. Run `npm start` in the `client` directory.
5. Click the `Connect` button in the browser to get started.