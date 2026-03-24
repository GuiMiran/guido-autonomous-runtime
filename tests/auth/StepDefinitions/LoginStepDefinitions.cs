using System;
using TechTalk.SpecFlow;
using Auth;
using NUnit.Framework;

namespace AuthTests.StepDefinitions
{
    [Binding]
    public class LoginStepDefinitions
    {
        private string _username;
        private bool _result;

        [Given(@"user logs in")]
        public void GivenUserLogsIn()
        {
            _username = "standard_user";
            var login = new Login();
            _result = login.LoginUser(_username);
        }

        [Then(@"success")]
        public void ThenSuccess()
        {
            Assert.IsTrue(_result);
        }
    }
}
