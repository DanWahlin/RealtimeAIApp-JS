# Realtime AI App

## Run the Project

1. Clone the project.
1. Create a `gpt-4o-realtime-preview` in Azure AI Foundry.
1. Add an `.env` file to the root of the project and add the Azure deployment name and endpoint. If running locally run `az ad sp create-for-rbac --name "your-app-name" --role contributor --scopes /subscriptions/{subscription-id}/resourceGroups/{resource-group} --sdk-auth` to get your AZURE_CLIENT_ID,  AZURE_TENANT_ID, and AZURE_CLIENT_SECRET values. Here's an example of the `.env` file:

```
OPENAI_API_KEY=
OPENAI_ENDPOINT=
OPENAI_DEPLOYMENT=gpt-4o-realtime-preview

AZURE_CLIENT_ID=
AZURE_TENANT_ID=
AZURE_CLIENT_SECRET=
```

2. Run `npm i` in the `client` and `server` directories.
3. Run `npm run dev` in the `server` directory.
4. Run `npm start` in the `client` directory.
5. Click the `Connect` button in the browser to get started.