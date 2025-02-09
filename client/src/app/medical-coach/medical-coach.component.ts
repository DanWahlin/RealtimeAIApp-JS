import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ChatToolbarComponent } from '../chat-toolbar/chat-toolbar.component';
import { MatIconModule } from '@angular/material/icon';

interface Patient {
  tab: 'Patient' | 'Symptoms' | 'Vitals';
  patientInfo: {
    name: string;
    dob: string;
    gender: string;
  };
  symptoms: {
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
  selector: 'app-medical-coach',
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
  templateUrl: './medical-coach.component.html',
  styleUrl: './medical-coach.component.css'
})
export class MedicalCoachComponent {
  patient: Patient = {
    tab: 'Patient',
    patientInfo: { name: '', dob: '', gender: '' },
    symptoms: [{ description: '', duration: '', severity: 1 }],
    vitals: { temperature: 98.6, bloodPressure: '', heartRate: 0 }
  };
  private tabs = ['Patient', 'Symptoms', 'Vitals'];
  private jsonSchema = this.generateSchemaFromObject(this.patient);
  instructions = `You are helping to edit a JSON object that represents a medical patient's personal information, symptoms, and vitals.
    This JSON object conforms to the following schema: 
    
    ${JSON.stringify(this.jsonSchema)}

    Listen to the user and collect information from them. Do not reply to them unless they explicitly ask for your input. Just listen.
    Each time they provide information that can be added to the JSON object, add it to the existing object,
    and then call the tool to save the updated object. Don't stop updating the JSON object.
    Even if you think the information is incorrect, accept it - do not try to correct mistakes.
    After each time you have called the JSON updating tool, just reply OK.
  `;

  private generateSchemaFromObject(obj: any): any {
    const schema: any = {
      type: 'object',
      properties: {}
    };

    Object.keys(obj).forEach(key => {
      const value = obj[key];
      if (Array.isArray(value)) {
        schema.properties[key] = {
          type: 'array',
          items: this.generateSchemaFromObject(value[0])
        };
      } else if (typeof value === 'object') {
        schema.properties[key] = this.generateSchemaFromObject(value);
      } else {
        schema.properties[key] = {
          type: typeof value
        };
      }
    });

    return schema;
  }

  get selectedTabIndex(): number {
    return this.tabs.indexOf(this.patient.tab);
  }

  onTabChanged(event: any): void {
    this.patient.tab = this.tabs[event.index] as Patient['tab'];
  }

  addSymptom() {
    this.patient.symptoms.push({ description: '', duration: '', severity: 1 });
  }

  removeSymptom(index: number) {
    this.patient.symptoms.splice(index, 1);
  }
}
