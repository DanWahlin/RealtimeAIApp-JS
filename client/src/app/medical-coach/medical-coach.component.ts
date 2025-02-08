import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ChatToolbarComponent } from '../chat-toolbar/chat-toolbar.component';


@Component({
  selector: 'app-medical-coach',
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ChatToolbarComponent
  ],
  templateUrl: './medical-coach.component.html',
  styleUrl: './medical-coach.component.css'
})
export class MedicalCoachComponent {
  instructions = `You are helping to edit a JSON object that represents a {modelDescription}.
    This JSON object conforms to the following schema: {jsonSchema}

    Listen to the user and collect information from them. Do not reply to them unless they explicitly
    ask for your input; just listen.
    Each time they provide information that can be added to the JSON object, add it to the existing object,
    and then call the tool to save the updated object. Don't stop updating the JSON object.
    Even if you think the information is incorrect, accept it - do not try to correct mistakes.
    After each time you have called the JSON updating tool, just reply OK.
  `;

  patient = {
    personalInfo: {
      name: '',
      dob: '',
      gender: '',
      insurance: ''
    },
    symptoms: {
      chiefComplaint: '',
      duration: '',
      severity: '',
      location: ''
    },
    vitals: {
      temperature: '',
      bloodPressure: '',
      heartRate: '',
      respiratoryRate: ''
    }
  };
}
