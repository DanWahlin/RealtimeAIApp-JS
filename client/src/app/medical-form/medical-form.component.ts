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

enum PatientTab {
  Patient = 'Patient',
  Symptoms = 'Symptoms',
  Vitals = 'Vitals'
}

interface Patient {
  tab: string;
  information: { name: string; dob: string; gender: string };
  symptoms: { id: number; description: string; duration: string; severity: number }[];
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
  private jsonSchema: any = {};
  private utilitiesService = inject(UtilitiesService);
  private initialPatientData: Patient = {
    tab: PatientTab.Patient,
    information: { name: '', dob: '', gender: '' },
    symptoms: [{ id: this.nextSymptomId++, description: '', duration: '', severity: 1 }],
    vitals: { temperature: 0.0, bloodPressure: '', heartRate: 0 }
  };
  instructions = `You are helping to edit a JSON object that represents a medical patient's personal information, symptoms, and vitals.
    This JSON object conforms to the following schema: 
    ${JSON.stringify(this.jsonSchema)}
  
    Listen to the user and collect information from them. Do not reply to them unless they explicitly ask for your input. Just listen.
    Each time they provide information that can be added to the JSON object, update the JSON object, and then save it.
    Do not attempt to correct their mistakes.
    After saving the updated object, just reply OK.
  `;
  selectedTabIndex = 0;
  // Simplest way to detect changes in nested objects 
  // Tried BehaviorSubject and Signal but the HTML had to be jacked up more than I wanted
  patient = this.utilitiesService.createProxy(this.initialPatientData, this.onPatientChanged.bind(this));
  realtimeManagerService = inject(RealTimeManagerService);

  ngOnInit() {   
    this.jsonSchema = this.utilitiesService.generateSchemaFromObject(this.patient);
  }

  private onPatientChanged() {
    // console.log('Patient changed:', this.patient);
    this.realtimeManagerService.sendMessage(`The current modelData value is ${JSON.stringify(this.patient)}. When updating this later, include all these same values if they are unchanged (or they will be overwritten with nulls).`);
  }

  onTabChanged(tabIndex: number): void {
    this.patient.tab = this.tabs[tabIndex];
    this.selectedTabIndex = tabIndex;
  }

  addSymptom() {
    this.patient.symptoms.push({ id: this.nextSymptomId++, description: '', duration: '', severity: 1 });
  }

  removeSymptom(id: number) {
    this.patient.symptoms = this.patient.symptoms.filter(s => s.id !== id);

    // Reset nextSymptomId if all symptoms are removed
    if (this.patient.symptoms.length === 0) {
      this.nextSymptomId = 1;
    }
  }
  
}
