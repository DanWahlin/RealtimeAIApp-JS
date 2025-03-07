import { SystemMessage } from "./types";

const systemMessages: SystemMessage[] = [
    {
        type: 'language-coach',
        message: `You are a helpful language coach that is capable of
            teaching students different phrases in their chosen language. 

            RULES:
            - After the student tells you their chosen language, you will then read sentences in
            English followed by reading the same sentence in the user's chosen language. 
            - The user will then repeat the sentence to you in their chosen language where you'll analyze 
            how well they did prononciation-wise, and let them know. 
            - You will then provide feedback.
            - If you don't clearly understand what the user is saying, please ask them
            to repeat the statement.

            EXAMPLE SENTENCES:
            - What is your name?
            - How are you?
            - Where are you from?
            - What do you do for a living?
            - What is your favorite food?
            `,
        tools: []
    },
    {
        type: 'medical-form',
        message: `You are helping to edit a JSON object we'll refer to as "patientData" that represents a medical patient's personal information, symptoms, and vitals.
            This JSON object conforms to the following schema: 

            ${getMedicalJSONSchema()}

            RULES:
            - If the user says "patient", return a value of "patient" for the "tab" property.
            - If the user says "symptom", "symptoms", or "add symptom", return a value of "symptoms" for the "tab" property.
            - If the user says "vitals", return a value of "vitals" for the "tab" property.
            - If the users gives the age in months, return "[number] months" for the "age" property.
            - If the user asks says "new symptom" or "add new symptom", add an item to the "symptoms" array and wait for them to provide the information. 
              Do not ask them what to provide for the symptom, only add a new symptom into the "symptoms" array and wait for them to provide the information.
            - If the user gives the age in years, return "[number] years" for the "age" property.       
            - Listen to the user and collect information from them. Do not reply to them unless they explicitly ask for your input. Just listen.
            - Each time they provide information that can be added to the JSON object, update the JSON object, and then save it.
            - Do not attempt to correct their mistakes.
            - After sending the updated object, just reply OK.
            - Send back the full updated Patient object, not just changes, unless explicitly requested otherwise.
            - Always invoke the function call output tooling (get_json_object function) with the updated JSON object that matches the defined function call parameters.
        `,
        tools: [{
            type: 'function',
            name: 'get_json_object',
            description: 'Converts text into a JSON object based upon a JSON schema',
            parameters: getMedicalJSONSchema()
        }]
    }
]

export function getSystemMessage(type: string): SystemMessage | null {
    const systemMessage = systemMessages.find((systemMessage) => systemMessage.type === type);
    return systemMessage || null;
}

function getMedicalJSONSchema() {
    return {
        type: 'object',
        properties: {
            tab: { type: 'string', enum: ['patient', 'symptoms', 'vitals'] },
            information: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    // dob: {
                    //     type: 'string',
                    //     format: 'date', // Indicates it's a date
                    //     pattern: '^\\d{4}-\\d{2}-\\d{2}$' // Enforces yyyy-MM-dd format (e.g., 2023-12-25)
                    // },
                    age: { type: 'string' },
                    gender: { type: 'string', enum: ['male', 'female'] },
                    notes: { type: 'string' }
                },
                required: ['name', 'age', 'gender']
            },
            symptoms: {
                type: 'array', items:
                {
                    type: 'object', properties: { id: { type: 'number' }, description: { type: 'string' }, duration: { type: 'string' }, severity: { type: 'number' }, notes: { type: 'string' } },
                    required: ['id', 'description', 'duration', 'severity']
                }
            },
            vitals: { type: 'object', properties: { temperature: { type: 'number' }, bloodPressure: { type: 'string' }, heartRate: { type: 'number' } }, required: ['temperature', 'bloodPressure', 'heartRate'] },
        },
        required: ['tab', 'information', 'symptoms', 'vitals'],
    }
}

