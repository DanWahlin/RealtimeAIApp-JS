import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ChatToolbarComponent } from '../chat-toolbar/chat-toolbar.component';
import { MatIconModule } from '@angular/material/icon';
import { UtilitiesService } from '@core/utilities.service';
import { RealTimeManagerService } from '@core/realtime-manager.service';
import { Message } from '@shared/interfaces';

enum PatientTab {
  Patient = 'Patient',
  Symptoms = 'Symptoms',
  Vitals = 'Vitals'
}

interface Symptom {
  id: number;
  description: string;
  duration: string;
  severity: number;
}

interface Patient {
  tab: PatientTab;
  information: { name: string; dob: string; gender: string };
  symptoms: Symptom[];
  vitals: { temperature: number; bloodPressure: string; heartRate: number };
}

@Component({
  selector: 'app-medical-form',
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ChatToolbarComponent
  ],
  templateUrl: './medical-form.component.html',
  styleUrl: './medical-form.component.css'
})
export class MedicalFormComponent implements OnInit {
  private nextSymptomId = 1;
  private tabs = Object.values(PatientTab);
  private utilitiesService = inject(UtilitiesService);
  private initialPatientData: Patient = {
    tab: PatientTab.Patient,
    information: { name: '', dob: '', gender: '' },
    symptoms: [{ id: this.nextSymptomId++, description: '', duration: '', severity: 1 }],
    vitals: { temperature: 0.0, bloodPressure: '', heartRate: 0 }
  };
  instructions = `You are helping to edit a JSON object we'll refer to as "patientData" that represents a medical patient's personal information, symptoms, and vitals.
    This JSON object conforms to the following schema: 

    ${this.createJsonSchema()}

    If the user says "Patient", return a value of "Patient" for the "tab" property.
    If the user says "Symptom" or "Symptoms", return a value of "Symptoms" for the "tab" property.
    If the user says "Vitals", return a value of "Vitals" for the "tab" property.
  
    Listen to the user and collect information from them. Do not reply to them unless they explicitly ask for your input. Just listen.
    Each time they provide information that can be added to the JSON object, update the JSON object, and then save it.
    Do not attempt to correct their mistakes.
    After sending the updated object, just reply OK.
    Send back the full updated Patient object, not just changes, unless explicitly requested otherwise.

    Always invoke the function call output tooling (get_json_object function) with the updated JSON object that matches the defined function call parameters.
  `;
  selectedTabIndex = 0;
  // Use definite assignment assertion (!) to indicate patient will be assigned in ngOnInit
  patient!: Patient;
  private isUpdating = false; // Flag to prevent reentrant updates
  private lastSentPatient: Patient | null = null; // Track last sent patient to avoid redundant sends
  private lastUpdateTimestamp = 0; // Track last update timestamp for debouncing
  private readonly DEBOUNCE_DELAY = 500; // 500ms debounce to prevent rapid updates
  private realtimeManagerService = inject(RealTimeManagerService);

  ngOnInit() {
    // Create proxy with a no-arg callback that calls onPatientChanged
    this.patient = this.utilitiesService.createProxy(this.initialPatientData, () => this.onPatientChanged());
  }

  createJsonSchema(): string {
    return JSON.stringify(this.utilitiesService.generateSchemaFromObject(this.patient));
  }

  private onPatientChanged(): void {
    if (this.isUpdating) return;
    const now = Date.now();
    if (now - this.lastUpdateTimestamp < this.DEBOUNCE_DELAY) return; // Debounce to prevent rapid updates

    this.isUpdating = true;
    try {
      // Only send if patient has changed since last send (deep comparison)
      if (!this.isEqual(this.lastSentPatient, this.patient)) {
        this.realtimeManagerService.sendMessage(`The updated patientData is ${JSON.stringify(this.patient)}.`);
        this.lastSentPatient = JSON.parse(JSON.stringify(this.patient)); // Deep copy to track state
        this.lastUpdateTimestamp = now; // Update timestamp after successful send
      }
    } finally {
      this.isUpdating = false;
    }
  }

  private isEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (Array.isArray(obj1[key]) && Array.isArray(obj2[key])) {
        if (!this.arraysEqual(obj1[key], obj2[key])) return false;
      } else if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
        if (!this.isEqual(obj1[key], obj2[key])) return false;
      } else if (obj1[key] !== obj2[key]) {
        return false;
      }
    }
    return true;
  }

  private arraysEqual(arr1: any[], arr2: any[]): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (Array.isArray(arr1[i]) && Array.isArray(arr2[i])) {
        if (!this.arraysEqual(arr1[i], arr2[i])) return false;
      } else if (typeof arr1[i] === 'object' && typeof arr2[i] === 'object') {
        if (!this.isEqual(arr1[i], arr2[i])) return false;
      } else if (arr1[i] !== arr2[i]) {
        return false;
      }
    }
    return true;
  }

  onTabChanged(tabIndex: number): void {
    this.patient.tab = this.tabs[tabIndex];
    this.selectedTabIndex = tabIndex;
  }

  addSymptom(): void {
    this.patient.symptoms.push({ id: this.nextSymptomId++, description: '', duration: '', severity: 1 });
  }

  removeSymptom(id: number): void {
    this.patient.symptoms = this.patient.symptoms.filter(s => s.id !== id);

    // Reset nextSymptomId if all symptoms are removed
    if (this.patient.symptoms.length === 0) {
      this.nextSymptomId = 1;
    }
  }

  onMessagesChanged(messages: Message[]): void {
    const functionCallOutputMessages = messages.filter(m => m.action === 'function_call_output');
    if (functionCallOutputMessages.length && !this.isUpdating) {
      this.isUpdating = true;
      try {
        const newModel = JSON.parse(functionCallOutputMessages[0].content) as Partial<Patient>;
        const mergedNewModel = this.mergeModel(newModel);
        this.patient = mergedNewModel;
        // const modelChanged = this.updateModelProperties(this.patient, mergedNewModel);
        console.log('patient changed:', this.patient);
      } catch (error) {
        console.error('Error parsing function call output:', error);
      } finally {
        this.isUpdating = false;
      }
    }
  }

  private updateModelProperties(oldModel: Patient, newModel: Patient): boolean {
    let foundChange = false;

    // Check and apply changes for each top-level property
    for (const key of Object.keys(newModel) as (keyof Patient)[]) {
      if (!this.isEqual(oldModel[key], newModel[key])) {
        foundChange = true;
        // Create new references for changed nested objects/arrays to ensure proxy detects changes
        if (key === 'tab') {
          oldModel.tab = newModel.tab;
        } 
        else if (key === 'information') {
          oldModel.information = { ...oldModel.information, ...newModel.information };
        } 
        else if (key === 'symptoms') {
          oldModel.symptoms = this.mergeSymptoms(newModel.symptoms, oldModel.symptoms);
        } 
        else if (key === 'vitals') {
          oldModel.vitals = { ...oldModel.vitals, ...newModel.vitals };
        }
      }
    }

    if (foundChange) {
      this.notifyFieldChanged(oldModel, Object.keys(newModel).join(', '));
    }

    return foundChange;
  }

  private mergeModel(partialModel: Partial<Patient>): Patient {
    // console.log('Patient:', this.patient);
    // console.log('Partial patient:', partialModel);
    const mergedPatient = { 
      tab: partialModel.tab || this.patient.tab,
      information: { ...this.patient.information, ...partialModel.information },
      symptoms: this.mergeSymptoms(partialModel.symptoms || [], this.patient.symptoms),
      vitals: { ...this.patient.vitals, ...partialModel.vitals }
    };
    //console.log('Merged patient:', mergedPatient);
    return mergedPatient;
  }

  private mergeSymptoms(newSymptoms: Symptom[], existingSymptoms: Symptom[]): Symptom[] {
    // Create a map of existing symptoms by id for efficient lookup and merging
    const symptomMap = new Map<number, Symptom>();
    existingSymptoms.forEach(symptom => symptomMap.set(symptom.id, { ...symptom }));

    // Merge new symptoms, updating existing ones or adding new ones
    newSymptoms.forEach(newSymptom => {
      symptomMap.set(newSymptom.id, { ...symptomMap.get(newSymptom.id), ...newSymptom });
    });

    // Convert map back to array, maintaining order (sort by id for consistency)
    return Array.from(symptomMap.values()).sort((a, b) => a.id - b.id);
  }

  private notifyFieldChanged(model: Patient, fieldNames: string): void {
    console.log(`Field changed: ${fieldNames} in model`, model);
  }
}