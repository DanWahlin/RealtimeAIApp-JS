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

## Architecture Overview

The following diagram illustrates the WebSocket communication flow in the `RTSession` class, showing how client messages are processed and relayed to the OpenAI Realtime API.

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 75}}}%%
graph TD
    A[Client] -->|Sends audio/text| B[clientWs]
    subgraph Realtime_Session["Realtime Session"]
        B[clientWs]
        C[Logic]
        D[openAiWs]
    end
    E[OpenAI Realtime API]

    B <-->|Receives responses| C
    C <-->|Processes messages| D
    D <-->|Sends audio/text to OpenAI| E
    E -->|Sends audio/text responses| D

    classDef sessionLabel font-size:20px;
    class Realtime_Session sessionLabel

    style A fill:#f9f,stroke:#333,stroke-width:2px,font-size:20px;
    style B fill:#bbf,stroke:#333,stroke-width:2px
    style C fill:#dfd,stroke:#333,stroke-width:2px
    style D fill:#bbf,stroke:#333,stroke-width:2px
    style E fill:#f9f,stroke:#333,stroke-width:2px