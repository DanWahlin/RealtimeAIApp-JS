import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ChatToolbarComponent } from '../chat-toolbar/chat-toolbar.component';
import { MatIconModule } from '@angular/material/icon';

enum PatientTab {
  Patient = 'Patient',
  Symptoms = 'Symptoms',
  Vitals = 'Vitals'
}

interface Patient {
  tab: string;
  information: {
    name: string;
    dob: string;
    gender: string;
  };
  symptoms: {
    id: number;
    description: string;
    duration: string;
    severity: number;
  }[];
  vitals: {
    temperature: number;
    bloodPressure: string;
    heartRate: number;
  };
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
export class MedicalFormComponent {
  patient: Patient;
  selectedTabIndex = 0;
  private nextSymptomId = 1;
  private tabs = ['Patient', 'Symptoms', 'Vitals'];
  private jsonSchema: any = {};
  private debounceTimer: any;
  instructions = `You are helping to edit a JSON object that represents a medical patient's personal information, symptoms, and vitals.
    This JSON object conforms to the following schema: 
    
    ${JSON.stringify(this.jsonSchema)}

    Listen to the user and collect information from them. Do not reply to them unless they explicitly ask for your input. Just listen.
    Each time they provide information that can be added to the JSON object, add it to the existing object,
    and then call the tool to save the updated object. Don't stop updating the JSON object.
    Even if you think the information is incorrect, accept it - do not try to correct mistakes.
    After each time you have called the JSON updating tool, just reply OK.
  `;

  constructor() {
    this.patient = this.createProxy({
      tab: PatientTab.Patient,
      information: { name: '', dob: '', gender: '' },
      symptoms: [{ id: this.nextSymptomId++, description: '', duration: '', severity: 1 }],
      vitals: { temperature: 0.0, bloodPressure: '', heartRate: 0 }
    });
    this.generateSchemaFromObject(this.patient);
  }

  private onPatientChanged() {
    // Send to server via WebSocket
    
  }

  onTabChanged(tabIndex: any): void {
    this.patient.tab = PatientTab[this.tabs[tabIndex] as keyof typeof PatientTab];
    console.log(this.patient.tab);
    this.selectedTabIndex = tabIndex;
  }

  addSymptom() {
    this.patient.symptoms.push({ id: this.nextSymptomId++, description: '', duration: '', severity: 1 });
  }

  removeSymptom(id: number) {
    this.patient.symptoms.splice(id - 1, 1);
    if (this.patient.symptoms.length === 0) {
      this.nextSymptomId = 1;
    }
  }

  private generateSchemaFromObject(obj: any): any {
    const schema: any = {
      type: 'object',
      required: [], // Add required fields
      properties: {}
    };
  
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      schema.required.push(key); // Mark all properties as required
  
      if (Array.isArray(value)) {
        schema.properties[key] = {
          type: 'array',
          items: this.generateSchemaFromObject(value[0]),
          minItems: 1 // Ensure at least one item in arrays
        };
      } else if (typeof value === 'object' && value !== null) {
        schema.properties[key] = this.generateSchemaFromObject(value);
      } else {
        schema.properties[key] = {
          type: typeof value,
          // Add specific constraints based on type
          ...(typeof value === 'number' && { minimum: 0 }),
          ...(typeof value === 'string' && { minLength: 1 })
        };
      }
    });
  
    return schema;
  }

  private createProxy<T extends object>(obj: T): T {
    return new Proxy(obj, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'object' && value !== null
          ? this.createProxy(value) // Recursively wrap nested objects
          : value;
      },
      set: (target, prop, value) => {
        Reflect.set(target, prop, value);
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.onPatientChanged();
        }, 500); // Adjust delay as needed
        return true;
      }
    });
  }

}
