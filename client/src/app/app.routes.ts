import { Routes } from '@angular/router';
import { LanguageCoachComponent } from './language-coach/language-coach.component';

export const routes: Routes = [
    { path: '', redirectTo: 'language-coach', pathMatch: 'full' },
    { path: 'language-coach', component: LanguageCoachComponent },
    { path: '**', redirectTo: 'language-coach', pathMatch: 'full' }
];
