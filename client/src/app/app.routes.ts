import { Routes } from '@angular/router';
import { LanguageCoachComponent } from './language-coach/language-coach.component';
import { MedicalFormComponent } from './medical-form/medical-form.component';

export const routes: Routes = [
    { path: '', redirectTo: '/language-coach', pathMatch: 'full' },
    { path: 'language-coach', component: LanguageCoachComponent },
    { path: 'medical-form', component: MedicalFormComponent },
    { path: '**', redirectTo: '/language-coach', pathMatch: 'full' }
];
